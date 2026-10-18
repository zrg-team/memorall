import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	SandboxRuntimePort,
	SandboxRuntimeStatus,
} from "@/platform/contracts/core";
import { platform } from "@/platform/current";
import type { MemonTerminalState } from "@/services/memon/types";
import { desktopSandboxController } from "@/services/sandbox-container/desktop-sandbox-controller";
import type { MemonSend } from "../types";
import { TerminalWindow } from "../windows/TerminalWindow";
import { TerminalScreen } from "../windows/terminal/terminal-screen";

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
	const originalRuntime = platform.sandboxRuntime;
	afterEach(() => {
		platform.sandboxRuntime = originalRuntime;
	});
	beforeEach(() => request.mockReset());
	it("blocks typing, paste, Enter and completion until the sandbox is ready", async () => {
		let status: SandboxRuntimeStatus = {
			ready: false,
			state: "starting",
			failure: null,
			initializedAt: null,
		};
		const runtime: SandboxRuntimePort = {
			status: vi.fn(async () => status),
			request: vi.fn(),
			stop: vi.fn(),
		};
		platform.sandboxRuntime = runtime;
		const { send } = await renderTerminal(terminalState());
		expect(
			screen.getByTestId("terminal-sandbox-blocked").textContent,
		).toContain("Starting");
		expect(textarea().disabled).toBe(true);
		typeText("ls");
		press("Enter");
		press("Tab");
		expect(send).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
		status = { ...status, ready: true, state: "ready" };
		await act(() => desktopSandboxController(runtime).refresh());
		expect(textarea().disabled).toBe(false);
		expect(screen.queryByTestId("terminal-sandbox-blocked")).toBeNull();
		typeText("ls");
		press("Enter");
		expect(send).toHaveBeenCalledWith(
			"terminal.exec",
			{ key: "m1", command: "ls", terminalId: "1" },
			{ rethrow: true },
		);
	});

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

	it("shows a structured command failure's message and accepts another command", async () => {
		const settled = vi.spyOn(TerminalScreen.prototype, "settleEcho");
		try {
			const { send } = await renderTerminal(terminalState());
			send.mockRejectedValueOnce({
				code: "VM_START_FAILED",
				message: "Sandbox could not start",
			});
			typeText("ls");
			press("Enter");
			await waitFor(() =>
				expect(settled).toHaveBeenCalledWith(
					expect.any(Number),
					"Sandbox could not start",
				),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			typeText("pwd");
			press("Enter");
			expect(send).toHaveBeenLastCalledWith(
				"terminal.exec",
				{ key: "m1", command: "pwd", terminalId: "1" },
				{ rethrow: true },
			);
		} finally {
			settled.mockRestore();
		}
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
