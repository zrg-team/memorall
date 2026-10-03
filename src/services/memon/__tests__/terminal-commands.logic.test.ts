import { describe, expect, it } from "vitest";
import {
	completeTerminalLine,
	completeTerminalPath,
	completionWord,
	expandHome,
	MEMON_TERMINAL_COMMANDS,
} from "../terminal/terminal-commands";
import { toTerminalLines } from "../terminal/terminal-output";

describe("Terminal Tab completion", () => {
	it("knows the shell's tools, the host commands and its own", () => {
		for (const command of ["ls", "grep", "curl", "git", "py", "node", "npm"]) {
			expect(MEMON_TERMINAL_COMMANDS).toContain(command);
		}
		expect(MEMON_TERMINAL_COMMANDS).toContain("history");
		expect(MEMON_TERMINAL_COMMANDS).toContain("clear");
	});

	it("completes a command with one match and adds the space", () => {
		expect(completeTerminalLine("hist")).toEqual({
			line: "history ",
			suggestions: [],
		});
		expect(completeTerminalLine("ls -la | gre").line).toBe("ls -la | grep ");
	});

	it("completes as far as the matches agree, and lists them", () => {
		const completion = completeTerminalLine("pyt");
		expect(completion.line).toBe("python");
		expect(completion.suggestions.map((entry) => entry.label)).toEqual([
			"python",
			"python3",
		]);
		// A name that is a command itself stays as typed.
		expect(completeTerminalLine("py").line).toBe("py");
	});

	it("offers the commands run before that start with the line", () => {
		const history = ["npm install", "npm run build", "ls", "npm run build"];
		expect(completeTerminalLine("npm run", history)).toEqual({
			line: "npm run build",
			suggestions: [],
		});
		const completion = completeTerminalLine("npm ", history);
		expect(completion.line).toBe("npm ");
		expect(completion.suggestions).toEqual([
			{ label: "npm run build", line: "npm run build", kind: "history" },
			{ label: "npm install", line: "npm install", kind: "history" },
		]);
		// Commands from the history complete too.
		expect(completeTerminalLine("./bu", ["./build.sh"]).line).toBe(
			"./build.sh ",
		);
	});
});

describe("Terminal Tab completion of paths", () => {
	const entries = [
		{ name: "site", type: "dir" as const },
		{ name: "notes.md", type: "file" as const },
		{ name: "notes old.md", type: "file" as const },
		{ name: "Memory.md", type: "file" as const },
		{ name: ".env", type: "file" as const },
	];
	const complete = (line: string) =>
		completeTerminalPath(line, completionWord(line), entries);

	it("reads the word being completed as the shell splits it", () => {
		expect(completionWord("gi")).toMatchObject({ value: "gi", command: true });
		expect(completionWord("cat no")).toMatchObject({
			start: 4,
			value: "no",
			command: false,
		});
		expect(completionWord("ls && gr")).toMatchObject({ command: true });
		expect(completionWord("cat my\\ no")).toMatchObject({
			value: "my no",
			quote: null,
		});
		expect(completionWord('cat "my no')).toMatchObject({
			start: 4,
			value: "my no",
			quote: '"',
		});
		expect(completionWord("echo hi > ou")).toMatchObject({
			value: "ou",
			command: false,
		});
		expect(completionWord("./bu")).toMatchObject({ command: false });
	});

	it("completes a folder with its slash and a file with a space", () => {
		expect(complete("cd si")).toEqual({ line: "cd site/", suggestions: [] });
		expect(complete("cat Mem")).toEqual({
			line: "cat Memory.md ",
			suggestions: [],
		});
		expect(complete("cat ~/sub/Mem").line).toBe("cat ~/sub/Memory.md ");
	});

	it("goes as far as the matches agree, then lists them", () => {
		expect(complete("cat no")).toEqual({ line: "cat notes", suggestions: [] });
		const listed = complete("cat notes");
		expect(listed.line).toBe("cat notes");
		expect(listed.suggestions).toEqual(
			expect.arrayContaining([
				{ label: "notes.md", line: "cat notes.md ", kind: "file" },
				{
					label: "notes old.md",
					line: "cat notes\\ old.md ",
					kind: "file",
				},
			]),
		);
		// Names with a dot show once the name does.
		expect(
			complete("cat ").suggestions.map((entry) => entry.label),
		).not.toContain(".env");
		expect(complete("cat .e").line).toBe("cat .env ");
	});

	it("keeps the quote the word opened", () => {
		expect(complete('cat "notes o').line).toBe('cat "notes old.md" ');
		expect(complete("cat 'si").line).toBe("cat 'site/");
	});
});

describe("Terminal output", () => {
	it("splits output into lines; a chunk ending mid-line ends partial", () => {
		expect(
			toTerminalLines([
				{ type: "stdout", text: "one\ntwo\n" },
				{ type: "status", text: "running" },
				{ type: "stdout", text: "Name? " },
				{ type: "stderr", text: "oops\nhalf" },
			]),
		).toEqual([
			{ kind: "stdout", text: "one" },
			{ kind: "stdout", text: "two" },
			{ kind: "stdout", text: "Name? ", partial: true },
			{ kind: "stderr", text: "oops" },
			{ kind: "stderr", text: "half", partial: true },
		]);
	});
});

describe("~ in Terminal commands", () => {
	it("becomes the home at the start of a word, outside quotes", () => {
		expect(expandHome("ls ~ ~/a ~b a~", "/agents/bot")).toBe(
			"ls /agents/bot /agents/bot/a ~b a~",
		);
		expect(expandHome("cat '~/a' \"~/b\" \\~/c", "/agents/bot")).toBe(
			"cat '~/a' \"~/b\" \\~/c",
		);
		expect(expandHome("cd ~/x && ls", "/agents/My Bot")).toBe(
			"cd '/agents/My Bot'/x && ls",
		);
	});
});
