import { describe, expect, it } from "vitest";
import {
	editLine,
	emptyLineEditor,
	type LineEditorEffect,
	type LineEditorState,
	lineEditorView,
	lineText,
} from "../windows/terminal/line-editor";
import { parseTerminalInput } from "../windows/terminal/terminal-keys";
import {
	cellWidth,
	EditCanvas,
	renderLines,
	renderSuggestions,
	sanitizeOutput,
} from "../windows/terminal/terminal-text";

/** Types `data` as xterm.js would send it; returns the state and effects. */
const type = (
	data: string,
	options: {
		state?: LineEditorState;
		history?: string[];
		stdin?: boolean;
	} = {},
) => {
	let state = options.state ?? emptyLineEditor();
	const effects: LineEditorEffect[] = [];
	for (const key of parseTerminalInput(data)) {
		const result = editLine(state, key, {
			history: options.history ?? [],
			stdin: options.stdin ?? false,
		});
		state = result.state;
		effects.push(...result.effects);
	}
	return { state, effects, line: lineText(state) };
};

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const HOME = "\x1b[H";

describe("terminal keys", () => {
	it("reads keys, modifiers and pastes the way xterm.js sends them", () => {
		expect(
			parseTerminalInput("ls\r\x1b[1;5D\x1bb\x7f\b\x03\x1b[3~\x1b[Z"),
		).toEqual([
			{ type: "text", text: "ls" },
			{ type: "key", name: "enter" },
			{ type: "key", name: "left", ctrl: true },
			{ type: "key", name: "b", alt: true },
			{ type: "key", name: "backspace" },
			{ type: "key", name: "backspace", ctrl: true },
			{ type: "key", name: "c", ctrl: true },
			{ type: "key", name: "delete" },
			{ type: "key", name: "tab", shift: true },
		]);
		expect(parseTerminalInput("\x1b[200~a\r\nb\x1b[201~x")).toEqual([
			{ type: "paste", text: "a\r\nb" },
			{ type: "text", text: "x" },
		]);
		expect(parseTerminalInput("\x1bOH\x1b[F\x1b")).toEqual([
			{ type: "key", name: "home" },
			{ type: "key", name: "end" },
			{ type: "key", name: "escape" },
		]);
	});
});

describe("line editor", () => {
	it("edits at the cursor, by character and by word", () => {
		expect(type(`helo${LEFT}l`).line).toBe("hello");
		expect(type(`git status${HOME}\x1b[1;5C${RIGHT}x`).line).toBe(
			"git xstatus",
		);
		// Backspace, Delete, Ctrl+A / Ctrl+E.
		expect(type(`abcd${LEFT}${LEFT}\x7f\x1b[3~`).line).toBe("ad");
		expect(type("world\x01hello \x05!").line).toBe("hello world!");
		// Accents stay with their letter.
		const accented = type(`tiếng việt${LEFT}${LEFT}\x7f`);
		expect(accented.line).toBe("tiếng vệt");
	});

	it("cuts with Ctrl+U/K/W and Alt+Backspace, and puts back with Ctrl+Y", () => {
		expect(type("npm run dev\x17").line).toBe("npm run ");
		expect(type("npm run dev\x1b\x7f").line).toBe("npm run ");
		const cut = type(`echo hello world${HOME}\x1b[1;5C\x0b`);
		expect(cut.line).toBe("echo");
		expect(type("\x19", { state: cut.state }).line).toBe("echo hello world");
		expect(type(`abc def${LEFT}${LEFT}\x15`).line).toBe("ef");
		// Ctrl+T swaps the two characters before the cursor.
		expect(type("sl\x14").line).toBe("ls");
	});

	it("goes through history with ↑/↓, keeping the line being typed", () => {
		const history = ["ls", "cd site", "npm run dev"];
		expect(type(`np${UP}`, { history }).line).toBe("npm run dev");
		expect(type(`np${UP}${UP}${UP}${UP}`, { history }).line).toBe("ls");
		expect(type(`np${UP}${UP}${DOWN}${DOWN}`, { history }).line).toBe("np");
		expect(type(`\x10\x10`, { history }).line).toBe("cd site");
		// Alt+. puts in the last word of the last command.
		expect(type("cat \x1b.", { history }).line).toBe("cat dev");
		// Into a running command there is no history.
		expect(type(UP, { history, stdin: true }).line).toBe("");
	});

	it("searches history with Ctrl+R", () => {
		const history = ["git status", "npm run build", "git commit", "ls"];
		const search = type("\x12git", { history });
		expect(lineEditorView(search.state, history)).toEqual({
			label: "(reverse-i-search)`git': ",
			chars: [..."git commit"],
			cursor: 0,
		});
		// Ctrl+R again: the one before; Enter runs it.
		const older = type("\x12\r", { history, state: search.state });
		expect(older.effects).toEqual([{ type: "submit", line: "git status" }]);
		// A key that edits takes the line found first.
		expect(type(`${RIGHT}`, { history, state: search.state }).line).toBe(
			"git commit",
		);
		// Nothing found says so; Ctrl+G puts back the line typed before.
		const failed = type("xyz\x12zzz", { history });
		expect(lineEditorView(failed.state, history).label).toBe(
			"(failed reverse-i-search)`zzz': ",
		);
		expect(type("\x07", { history, state: failed.state }).line).toBe("xyz");
	});

	it("runs a line on Enter, and continues one ending in \\ or an open quote", () => {
		expect(type("ls -la\r").effects).toEqual([
			{ type: "submit", line: "ls -la" },
		]);
		const continued = type("echo 'a\rb'\r");
		expect(continued.effects).toEqual([
			{ type: "submit", line: "echo 'a\nb'" },
		]);
		expect(type("npm \\\rrun\r").effects).toEqual([
			{ type: "submit", line: "npm \\\nrun" },
		]);
		// Into a running command a line is a line.
		expect(type("echo 'a\r", { stdin: true }).effects).toEqual([
			{ type: "submit", line: "echo 'a" },
		]);
	});

	it("pastes as it is, and into a running command one line at a time", () => {
		const pasted = type("\x1b[200~npm i\r\nnpm test\n\x1b[201~");
		expect(pasted.line).toBe("npm i\nnpm test");
		expect(pasted.effects).toEqual([]);
		expect(
			type("\x1b[200~yes\nno\nmaybe\x1b[201~", { stdin: true }),
		).toMatchObject({
			line: "maybe",
			effects: [
				{ type: "submit", line: "yes" },
				{ type: "submit", line: "no" },
			],
		});
	});

	it("asks for Tab, Ctrl+C, Ctrl+L and Ctrl+D", () => {
		expect(type(`git sta${LEFT}${LEFT}\t`).effects).toEqual([
			{ type: "complete", before: "git s", after: "ta" },
		]);
		const stopped = type("npm run dev\x03");
		expect(stopped.effects).toEqual([
			{ type: "interrupt", line: "npm run dev" },
		]);
		expect(stopped.line).toBe("");
		expect(type("\x0c").effects).toEqual([{ type: "clearScreen" }]);
		expect(type("\x04").effects).toEqual([{ type: "eof" }]);
		expect(type("ab\x01\x04").line).toBe("b");
	});
});

describe("terminal text", () => {
	it("measures cells as xterm.js does", () => {
		expect(cellWidth("a")).toBe(1);
		expect(cellWidth("ế")).toBe(1);
		expect(cellWidth("中")).toBe(2);
		expect(cellWidth("e\u0301")).toBe(1);
	});

	it("keeps colors and in-line moves, and drops what would move off the line", () => {
		expect(
			sanitizeOutput(
				"\x1b[32mok\x1b[0m \x1b[2K\rdone\x1b[1A\x1b[?1049h\x1b]0;title\x07\x07",
			),
		).toBe("\x1b[32mok\x1b[0m \x1b[2K\rdone");
	});

	it("writes lines, a partial one continued by what follows", () => {
		const { data, partial } = renderLines(
			[
				{ kind: "command", text: "node ask.js", cwd: "/agents/Bot" },
				{ kind: "stdout", text: "Name? ", partial: true },
				{ kind: "input", text: "Ann" },
				{ kind: "stderr", text: "warn" },
				{ kind: "stdout", text: "50%", partial: true },
			],
			"/agents/Bot",
			false,
		);
		expect(data).toBe(
			"\x1b[1;32muser@memon\x1b[0m:\x1b[1;34m~\x1b[0m$ node ask.js\r\n" +
				"Name? Ann\r\n\x1b[31mwarn\x1b[0m\r\n50%",
		);
		expect(partial).toBe(true);
		// A command after a partial line starts a row of its own.
		expect(
			renderLines([{ kind: "command", text: "ls", cwd: "/" }], "/h", true).data,
		).toMatch(/^\r\n/);
	});

	it("lists Tab's matches in columns, folders in blue", () => {
		expect(
			renderSuggestions(
				[
					{ label: "src/", line: "", kind: "dir" },
					{ label: "a.txt", line: "", kind: "file" },
					{ label: "b.txt", line: "", kind: "file" },
				],
				20,
			),
		).toBe("\x1b[1;34msrc/\x1b[0m   b.txt\r\na.txt\r\n");
	});

	it("lays out the line, wrapping at the width, and puts the cursor back", () => {
		const canvas = new EditCanvas(10, 0);
		canvas.text("abcdefgh");
		canvas.markCursor();
		canvas.text("ijkl");
		// Ends on row 1 at column 2; the cursor goes up a row, to column 8.
		expect(canvas.finish()).toEqual({
			data: "abcdefghijkl\x1b[1A\r\x1b[8C",
			cursorRow: 0,
		});
		// A full row: the cursor starts the next one.
		const full = new EditCanvas(4, 0);
		full.text("abcd");
		expect(full.finish()).toEqual({ data: "abcd \b\r", cursorRow: 1 });
		// A wide character does not split: it starts the next row.
		const wide = new EditCanvas(4, 2);
		wide.text("a中");
		expect(wide.finish()).toEqual({ data: "a中\r\x1b[2C", cursorRow: 1 });
		expect(new EditCanvas(10, 3).finish()).toBeNull();
	});
});
