import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemonTerminalState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { TerminalWindow } from "../windows/TerminalWindow";

const request = vi.fn();
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

const HOME = "/agents/Bot";

const terminalState = (
	overrides: Partial<MemonTerminalState> = {},
): MemonTerminalState => ({
	cwd: HOME,
	lines: [],
	lineOffset: 0,
	screenId: 1,
	runningProcessId: null,
	runningCommand: null,
	startedAt: null,
	lastOutputAt: null,
	lastExitCode: null,
	approval: null,
	servers: [],
	tabs: [{ id: "1", cwd: HOME, running: false }],
	activeTabId: "1",
	runningTabId: null,
	history: ["ls", "npm run dev"],
	...overrides,
});

const running = terminalState({
	runningProcessId: "p1",
	runningCommand: "node ask.js",
	startedAt: Date.now(),
	lastOutputAt: Date.now(),
	runningTabId: "1",
	tabs: [{ id: "1", cwd: HOME, running: true }],
});

/** xterm.js reads the keyboard from its textarea. */
const textarea = () => {
	const element = document.querySelector<HTMLTextAreaElement>(
		".xterm-helper-textarea",
	);
	if (!element) throw new Error("the terminal is not open");
	return element;
};
const typeText = (text: string) =>
	textarea().dispatchEvent(
		new InputEvent("input", { data: text, inputType: "insertText" }),
	);
const KEY_CODES: Record<string, number> = {
	Enter: 13,
	Tab: 9,
	ArrowUp: 38,
	c: 67,
	l: 76,
};
const press = (key: string, init: KeyboardEventInit = {}) =>
	textarea().dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			keyCode: KEY_CODES[key],
			bubbles: true,
			cancelable: true,
			...init,
		}),
	);

const renderTerminal = async (terminal: MemonTerminalState) => {
	const send = vi.fn(async () => undefined);
	const view = render(
		<TerminalWindow
			machineKey="m1"
			terminal={terminal}
			home={HOME}
			send={send as unknown as MemonSend}
		/>,
	);
	await waitFor(() => textarea());
	return { send, view };
};

describe("TerminalWindow", () => {
	beforeEach(() => request.mockReset());

	it("runs the line typed at the prompt on Enter", async () => {
		const { send } = await renderTerminal(terminalState());
		typeText("ls -la");
		press("Enter");
		expect(send).toHaveBeenCalledWith(
			"terminal.exec",
			{ key: "m1", command: "ls -la", terminalId: "1" },
			{ rethrow: true },
		);
	});

	it("recalls the command before with ↑", async () => {
		const { send } = await renderTerminal(terminalState());
		press("ArrowUp");
		press("Enter");
		expect(send).toHaveBeenCalledWith(
			"terminal.exec",
			expect.objectContaining({ command: "npm run dev" }),
			{ rethrow: true },
		);
	});

	it("completes with Tab, from what the computer has", async () => {
		request.mockResolvedValue({ line: "cat notes.md ", suggestions: [] });
		const { send } = await renderTerminal(terminalState());
		typeText("cat no");
		press("Tab");
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith("terminal.complete", {
				key: "m1",
				line: "cat no",
				terminalId: "1",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		press("Enter");
		expect(send).toHaveBeenCalledWith(
			"terminal.exec",
			expect.objectContaining({ command: "cat notes.md " }),
			{ rethrow: true },
		);
	});

	it("types into the running command, and stops it with Ctrl+C", async () => {
		const { send } = await renderTerminal(running);
		typeText("Ann");
		press("Enter");
		expect(send).toHaveBeenCalledWith(
			"terminal.input",
			{ key: "m1", text: "Ann" },
			{ rethrow: true },
		);
		press("c", { ctrlKey: true });
		expect(send).toHaveBeenCalledWith("terminal.stop", { key: "m1" });
	});

	it("clears the screen with Ctrl+L", async () => {
		const { send } = await renderTerminal(terminalState());
		press("l", { ctrlKey: true });
		expect(send).toHaveBeenCalledWith("terminal.clear", {
			key: "m1",
			terminalId: "1",
		});
	});

	it("is where the agent's cursor points for the Terminal", async () => {
		await renderTerminal(terminalState());
		expect(document.querySelector('[data-memon-ref="t1"]')).not.toBeNull();
	});
});
