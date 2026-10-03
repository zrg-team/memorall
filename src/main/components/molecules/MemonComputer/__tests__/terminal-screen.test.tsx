import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import type { MemonTerminalLine } from "@/services/memon/types";
import type { LineEditorView } from "../windows/terminal/line-editor";
import { TerminalScreen } from "../windows/terminal/terminal-screen";

const HOME = "/agents/Bot";

const view = (text: string, cursor = [...text].length): LineEditorView => ({
	label: null,
	chars: [...text],
	cursor,
});

/** A real xterm.js terminal (not opened: no DOM needed) and its screen. */
const setup = (cols = 40) => {
	const term = new Terminal({ cols, rows: 12, allowProposedApi: true });
	const screen = new TerminalScreen(term, HOME);
	let lines: MemonTerminalLine[] = [];
	let key = "1:1";
	const show = async (next: MemonTerminalLine[], screenKey = key) => {
		lines = next;
		key = screenKey;
		screen.setSource({ key, lines, offset: 0 });
		await screen.idle();
	};
	/** The screen's rows, trailing blanks dropped. */
	const rows = (): string[] => {
		const buffer = term.buffer.active;
		const out: string[] = [];
		for (let index = 0; index < buffer.length; index += 1) {
			out.push(
				(buffer.getLine(index)?.translateToString(true) ?? "").trimEnd(),
			);
		}
		while (out.length && !out.at(-1)) out.pop();
		return out;
	};
	const cursor = () => {
		const buffer = term.buffer.active;
		return { row: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
	};
	return { term, screen, show, rows, cursor, lines: () => lines };
};

describe("TerminalScreen", () => {
	it("prints output above the line being typed, which stays as it was", async () => {
		const { screen, show, rows, cursor } = setup();
		await show([
			{ kind: "command", text: "npm run dev", cwd: HOME },
			{ kind: "stdout", text: "ready" },
		]);
		screen.setInput({ promptCwd: HOME, view: view("ls -la", 2) });
		await screen.idle();
		expect(rows()).toEqual([
			"user@memon:~$ npm run dev",
			"ready",
			"user@memon:~$ ls -la",
		]);
		expect(cursor()).toEqual({ row: 2, col: "user@memon:~$ ls".length });

		await show([
			{ kind: "command", text: "npm run dev", cwd: HOME },
			{ kind: "stdout", text: "ready" },
			{ kind: "stderr", text: "a warning" },
		]);
		expect(rows()).toEqual([
			"user@memon:~$ npm run dev",
			"ready",
			"a warning",
			"user@memon:~$ ls -la",
		]);
		expect(cursor()).toEqual({ row: 3, col: "user@memon:~$ ls".length });
	});

	it("continues a partial line: an answer goes after the question", async () => {
		const { screen, show, rows, cursor } = setup();
		await show([
			{ kind: "command", text: "node ask.js", cwd: HOME },
			{ kind: "stdout", text: "Name? ", partial: true },
		]);
		// A command runs: no prompt, the line typed follows the output.
		screen.setInput({ promptCwd: null, view: view("Ann") });
		await screen.idle();
		expect(rows()).toEqual(["user@memon:~$ node ask.js", "Name? Ann"]);
		expect(cursor()).toEqual({ row: 1, col: "Name? Ann".length });

		// Enter: shown at once, then the tab's input line takes its place.
		screen.setInput({ promptCwd: null, view: view("") });
		screen.echo("input", "Ann", HOME);
		await screen.idle();
		expect(rows()).toEqual(["user@memon:~$ node ask.js", "Name? Ann"]);
		expect(cursor()).toEqual({ row: 2, col: 0 });
		await show([
			{ kind: "command", text: "node ask.js", cwd: HOME },
			{ kind: "stdout", text: "Name? ", partial: true },
			{ kind: "input", text: "Ann" },
			{ kind: "stdout", text: "Hi Ann" },
		]);
		expect(rows()).toEqual([
			"user@memon:~$ node ask.js",
			"Name? Ann",
			"Hi Ann",
		]);
	});

	it("shows a command sent until the tab has it, once", async () => {
		const { screen, show, rows } = setup();
		await show([]);
		screen.setInput({ promptCwd: HOME, view: view("") });
		const echo = screen.echo("command", "ls", HOME);
		// Sent, not answered yet: no prompt.
		screen.setInput({ promptCwd: null, view: view("") });
		await screen.idle();
		expect(rows()).toEqual(["user@memon:~$ ls"]);
		await show([
			{ kind: "command", text: "ls", cwd: HOME },
			{ kind: "stdout", text: "notes.md" },
		]);
		screen.setInput({ promptCwd: HOME, view: view("") });
		screen.settleEcho(echo);
		await screen.idle();
		expect(rows()).toEqual(["user@memon:~$ ls", "notes.md", "user@memon:~$"]);
	});

	it("keeps a command that failed on screen, with its error", async () => {
		const { screen, show, rows } = setup();
		await show([]);
		const echo = screen.echo("command", "npm test", HOME);
		screen.settleEcho(echo, "`npm run dev` is still running in tab 2");
		screen.setInput({ promptCwd: HOME, view: view("") });
		await screen.idle();
		expect(rows()).toEqual([
			"user@memon:~$ npm test",
			"`npm run dev` is still running in tab 2",
			"user@memon:~$",
		]);
	});

	it("wraps a long line and leaves nothing behind when output comes", async () => {
		const { screen, show, rows, cursor } = setup(20);
		await show([]);
		const typed = "echo the quick brown fox jumps";
		screen.setInput({ promptCwd: HOME, view: view(typed, 4) });
		await screen.idle();
		expect(rows()).toEqual([
			`user@memon:~$ ${typed}`.slice(0, 20),
			`user@memon:~$ ${typed}`.slice(20, 40),
			`user@memon:~$ ${typed}`.slice(40),
		]);
		expect(cursor()).toEqual({ row: 0, col: "user@memon:~$ echo".length });
		await show([{ kind: "stdout", text: "tick" }]);
		expect(rows()).toEqual([
			"tick",
			`user@memon:~$ ${typed}`.slice(0, 20),
			`user@memon:~$ ${typed}`.slice(20, 40),
			`user@memon:~$ ${typed}`.slice(40),
		]);
		expect(cursor()).toEqual({ row: 1, col: "user@memon:~$ echo".length });
		// A line exactly as wide as the screen: the cursor starts the next row.
		screen.setInput({ promptCwd: HOME, view: view("123456") });
		await screen.idle();
		expect(rows()).toEqual(["tick", "user@memon:~$ 123456"]);
		expect(cursor()).toEqual({ row: 2, col: 0 });
	});

	it("draws a cleared screen, and the width it is resized to, anew", async () => {
		const { term, screen, show, rows } = setup(30);
		await show([
			{ kind: "command", text: "ls", cwd: HOME },
			{ kind: "stdout", text: "notes.md" },
		]);
		screen.print("listed\r\n");
		screen.setInput({ promptCwd: HOME, view: view("cat notes.md") });
		await screen.idle();
		expect(rows()).toEqual([
			"user@memon:~$ ls",
			"notes.md",
			"listed",
			"user@memon:~$ cat notes.md",
		]);
		term.resize(16, 12);
		screen.redraw();
		await screen.idle();
		expect(rows()).toEqual([
			"user@memon:~$ ls",
			"notes.md",
			"user@memon:~$ ca",
			"t notes.md",
		]);
		await show([], "1:2");
		expect(rows()).toEqual(["user@memon:~$ ca", "t notes.md"]);
	});
});
