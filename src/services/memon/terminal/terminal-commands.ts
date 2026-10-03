import { SHELL_TOOLS } from "@/services/sandbox-container/alongside-commands";
import { HOST_COMMAND_NAMES } from "@/services/sandbox-container/host-commands";

/** Lines the Terminal runs itself: a tab's directory, screen and history. */
export const MEMON_TERMINAL_BUILTINS = ["cd", "clear", "history"] as const;

/** What the sandbox runs besides the shell's tools. */
const RUNTIME_COMMANDS = [
	"node",
	"npm",
	"npx",
	"bash",
	"sh",
	"env",
	"sleep",
	"timeout",
	"xargs",
];

/** Every command the Terminal knows, for Tab to complete. */
export const MEMON_TERMINAL_COMMANDS: readonly string[] = [
	...new Set([
		...MEMON_TERMINAL_BUILTINS,
		...SHELL_TOOLS,
		...HOST_COMMAND_NAMES,
		...RUNTIME_COMMANDS,
	]),
].sort();

export interface MemonTerminalSuggestion {
	/** What the list shows. */
	label: string;
	/** The whole input line once it is picked. */
	line: string;
	kind: "command" | "history" | "file" | "dir";
}

export interface MemonTerminalCompletion {
	/** The line after Tab: completed as far as every match agrees. */
	line: string;
	/** The matches, when there is more than one to pick from. */
	suggestions: MemonTerminalSuggestion[];
}

/** Where the command being typed starts: after the last |, ; or &. */
const commandStart = (line: string): number => {
	let quote: string | null = null;
	let start = 0;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else if (char === "|" || char === ";" || char === "&") {
			start = index + 1;
		}
	}
	return start;
};

const commonPrefix = (values: readonly string[]): string => {
	if (!values.length) return "";
	let prefix = values[0] as string;
	for (const value of values) {
		while (!value.startsWith(prefix)) prefix = prefix.slice(0, -1);
	}
	return prefix;
};

const MAX_HISTORY_SUGGESTIONS = 8;

/**
 * Tab in the Terminal, as a shell does it: the command being typed is
 * completed from the commands the Terminal knows and the ones run before, as
 * far as every match agrees; earlier lines that start with what is typed are
 * offered too.
 */
export const completeTerminalLine = (
	line: string,
	history: readonly string[] = [],
	commands: readonly string[] = MEMON_TERMINAL_COMMANDS,
): MemonTerminalCompletion => {
	const start = commandStart(line);
	const segment = line.slice(start);
	const lead = /^\s*/.exec(segment)?.[0] ?? "";
	const word = segment.slice(lead.length);
	const before = line.slice(0, start) + lead;
	const recent = [...history].reverse();

	const names = /\s/.test(word)
		? []
		: [
				...new Set([
					...commands,
					...recent.map((entry) => entry.trim().split(/\s+/)[0] ?? ""),
				]),
			]
				.filter((name) => name?.startsWith(word) && name !== word)
				.sort();
	const exact = !/\s/.test(word) && word !== "" && commands.includes(word);
	const earlier = line.trim()
		? [...new Set(recent)]
				.filter((entry) => entry.startsWith(line) && entry !== line)
				.slice(0, MAX_HISTORY_SUGGESTIONS)
		: [];

	const suggestions: MemonTerminalSuggestion[] = [
		...names.map((name) => ({
			label: name,
			line: `${before}${name} `,
			kind: "command" as const,
		})),
		...earlier.map((entry) => ({
			label: entry,
			line: entry,
			kind: "history" as const,
		})),
	];

	// A whole command name typed: Tab puts the space after it.
	if (exact && !names.length) {
		return {
			line: `${line} `,
			suggestions: earlier.length > 1 ? suggestions : [],
		};
	}
	// One command it can be: Tab again offers the lines run with it.
	if (names.length === 1 && !exact) {
		return { line: `${before}${names[0]} `, suggestions: [] };
	}
	if (!names.length && earlier.length === 1) {
		return { line: earlier[0] as string, suggestions: [] };
	}
	// A typed name that is a command itself is as far as the matches agree.
	const completed =
		names.length && !exact ? `${before}${commonPrefix(names)}` : line;
	return {
		line: completed.length > line.length ? completed : line,
		suggestions,
	};
};

/** The word Tab completes, as the shell reads it. */
export interface MemonCompletionWord {
	/** Where it starts in the line. */
	start: number;
	/** What it says, its quotes and escapes taken away. */
	value: string;
	/** The quote it opened and has not closed yet. */
	quote: "'" | '"' | null;
	/** The first word of a command: a command name, not a path. */
	command: boolean;
}

/** The last word of a line, read the way the shell splits it. */
export const completionWord = (line: string): MemonCompletionWord => {
	let start = 0;
	let value = "";
	let quote: "'" | '"' | null = null;
	// Words already in this command, and whether a redirection wants a path.
	let words = 0;
	let redirect = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index] as string;
		if (quote) {
			if (char === quote) {
				quote = null;
			} else if (char === "\\" && quote === '"' && index + 1 < line.length) {
				value += line[index + 1];
				index += 1;
			} else {
				value += char;
			}
			continue;
		}
		if (char === "\\") {
			value += line[index + 1] ?? "";
			index += 1;
		} else if (char === "'" || char === '"') {
			quote = char;
		} else if (/\s/.test(char) || "|;&()<>".includes(char)) {
			if (index > start) {
				if (!redirect) words += 1;
				redirect = false;
			}
			if ("|;&(".includes(char)) {
				words = 0;
				redirect = false;
			} else if ("<>".includes(char)) {
				redirect = true;
			}
			start = index + 1;
			value = "";
		} else {
			value += char;
		}
	}
	return {
		start,
		value,
		quote,
		command:
			words === 0 &&
			!redirect &&
			!value.includes("/") &&
			!value.startsWith("~") &&
			!value.startsWith("."),
	};
};

/** A path being typed: the folder it is in, and the start of its name. */
export const splitCompletionPath = (
	value: string,
): { dir: string; base: string } => {
	const slash = value.lastIndexOf("/");
	return slash < 0
		? { dir: "", base: value }
		: { dir: value.slice(0, slash + 1), base: value.slice(slash + 1) };
};

/** Characters a shell word must escape. */
const SHELL_SPECIAL = /[\s'"\\$`!&;|()<>*?[\]{}#]/g;

/** A path as typed in a word: escaped, or inside the quote the word opened. */
const typedPath = (path: string, quote: "'" | '"' | null): string => {
	if (quote === '"') return path.replace(/["\\$`]/g, "\\$&");
	if (quote === "'") return path.replace(/'/g, "'\\''");
	return path.replace(SHELL_SPECIAL, "\\$&");
};

/**
 * Tab on a path, given what its folder holds: the name as far as every match
 * agrees (a folder gets its `/`, a file the space after it), else the matches
 * to pick from. Names starting with a dot show once the name does.
 */
export const completeTerminalPath = (
	line: string,
	word: MemonCompletionWord,
	entries: readonly { name: string; type: "file" | "dir" }[],
): MemonTerminalCompletion => {
	const { dir, base } = splitCompletionPath(word.value);
	const matches = entries
		.filter(
			(entry) =>
				entry.name.startsWith(base) &&
				entry.name !== "." &&
				entry.name !== ".." &&
				(base.startsWith(".") || !entry.name.startsWith(".")),
		)
		.sort((a, b) => a.name.localeCompare(b.name));
	const head = line.slice(0, word.start);
	const opened = word.quote ?? "";
	const lineWith = (name: string, done: "dir" | "file" | null): string => {
		const typed = `${head}${opened}${typedPath(`${dir}${name}`, word.quote)}`;
		if (done === "dir") return `${typed}/`;
		if (done === "file") return `${typed}${opened} `;
		return typed;
	};
	if (matches.length === 1) {
		const [match] = matches as [(typeof matches)[number]];
		return { line: lineWith(match.name, match.type), suggestions: [] };
	}
	if (!matches.length) return { line, suggestions: [] };
	const prefix = commonPrefix(matches.map((entry) => entry.name));
	if (prefix.length > base.length) {
		return { line: lineWith(prefix, null), suggestions: [] };
	}
	return {
		line,
		suggestions: matches.map((entry) => ({
			label: entry.type === "dir" ? `${entry.name}/` : entry.name,
			line: lineWith(entry.name, entry.type),
			kind: entry.type,
		})),
	};
};

const SAFE_PATH = /^[\w@%+=:,./-]+$/;

/** A path as one shell word. */
export const shellQuote = (path: string): string =>
	SAFE_PATH.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;

/**
 * A shell's tilde expansion: `~` alone or as `~/…` at the start of a word,
 * outside quotes, becomes the home folder.
 */
export const expandHome = (command: string, home: string): string => {
	if (!command.includes("~")) return command;
	const replacement = shellQuote(home);
	let out = "";
	let quote: string | null = null;
	for (let index = 0; index < command.length; index += 1) {
		const char = command[index] as string;
		if (quote) {
			if (char === quote) quote = null;
			out += char;
			continue;
		}
		if (char === "\\") {
			out += char + (command[index + 1] ?? "");
			index += 1;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			out += char;
			continue;
		}
		const previous = command[index - 1];
		const next = command[index + 1];
		if (
			char === "~" &&
			(previous === undefined || /[\s=:;|&(]/.test(previous)) &&
			(next === undefined || /[\s/;|&)]/.test(next))
		) {
			out += replacement;
			continue;
		}
		out += char;
	}
	return out;
};
