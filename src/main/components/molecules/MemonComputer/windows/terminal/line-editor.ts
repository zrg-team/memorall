import { completionWord } from "@/services/memon/terminal/terminal-commands";
import type { TerminalKey } from "./terminal-keys";
import { graphemes, stripControls } from "./terminal-text";

/**
 * The line being typed in the Terminal, edited the way a shell's readline
 * edits it: the cursor moves by character and word, Ctrl+U/K/W cut and Ctrl+Y
 * puts back, ↑/↓ go through the commands run before, Ctrl+R searches them,
 * Tab completes. Pure: each key gives the next state and what to do.
 */

export interface LineEditorSearch {
	query: string;
	/** The history entry found, or null. */
	match: number | null;
	failed: boolean;
	/** The line before the search: Ctrl+G puts it back. */
	original: { chars: string[]; cursor: number };
}

export interface LineEditorState {
	/** The line, as characters. */
	chars: string[];
	cursor: number;
	/** The history entry ↑/↓ show, or null for the line being typed. */
	historyIndex: number | null;
	/** The line being typed, kept while ↑/↓ go through history. */
	draft: string[];
	/** What was cut last, for Ctrl+Y. */
	killed: string;
	search: LineEditorSearch | null;
}

export type LineEditorEffect =
	/** Enter: the line runs (or, into a running command, is typed into it). */
	| { type: "submit"; line: string }
	/** Ctrl+C: the line is dropped, a running command stopped. */
	| { type: "interrupt"; line: string }
	/** Tab: the text before the cursor is to be completed. */
	| { type: "complete"; before: string; after: string }
	/** Ctrl+L. */
	| { type: "clearScreen" }
	/** Ctrl+D on an empty line: the shell ends (the tab closes). */
	| { type: "eof" }
	/** Shift+Page Up / Down. */
	| { type: "scroll"; pages: number };

export interface LineEditorContext {
	/** Commands run before, oldest first. */
	history: readonly string[];
	/**
	 * Typing into a running command: no history or search, and each line of
	 * a paste goes to it on its own.
	 */
	stdin: boolean;
}

export const emptyLineEditor = (killed = ""): LineEditorState => ({
	chars: [],
	cursor: 0,
	historyIndex: null,
	draft: [],
	killed,
	search: null,
});

export const lineText = (state: LineEditorState): string =>
	state.chars.join("");

/** What the line shows: during a search, the search and what it found. */
export interface LineEditorView {
	/** Shown instead of the prompt. */
	label: string | null;
	chars: string[];
	cursor: number;
}

export const lineEditorView = (
	state: LineEditorState,
	history: readonly string[],
): LineEditorView => {
	const { search } = state;
	if (!search) {
		return { label: null, chars: state.chars, cursor: state.cursor };
	}
	const entry =
		search.match === null
			? lineText({ ...state, chars: search.original.chars })
			: (history[search.match] ?? "");
	const chars = graphemes(entry);
	const at = search.query ? entry.indexOf(search.query) : -1;
	return {
		label: `(${search.failed ? "failed " : ""}reverse-i-search)\`${search.query}': `,
		chars,
		cursor: at < 0 ? chars.length : graphemes(entry.slice(0, at)).length,
	};
};

interface Result {
	state: LineEditorState;
	effects: LineEditorEffect[];
}

const done = (
	state: LineEditorState,
	...effects: LineEditorEffect[]
): Result => ({ state, effects });

const isWordChar = (char: string | undefined): boolean =>
	char !== undefined && /[\p{L}\p{N}_]/u.test(char);
const isSpace = (char: string | undefined): boolean =>
	char !== undefined && /^\s$/.test(char);

/** The start of the word before `at`. */
const wordStart = (chars: readonly string[], at: number): number => {
	let index = at;
	while (index > 0 && !isWordChar(chars[index - 1])) index -= 1;
	while (index > 0 && isWordChar(chars[index - 1])) index -= 1;
	return index;
};

/** The end of the word after `at`. */
const wordEnd = (chars: readonly string[], at: number): number => {
	let index = at;
	while (index < chars.length && !isWordChar(chars[index])) index += 1;
	while (index < chars.length && isWordChar(chars[index])) index += 1;
	return index;
};

/** Ctrl+W's word: back to the space before it. */
const spaceWordStart = (chars: readonly string[], at: number): number => {
	let index = at;
	while (index > 0 && isSpace(chars[index - 1])) index -= 1;
	while (index > 0 && !isSpace(chars[index - 1])) index -= 1;
	return index;
};

const edited = (
	state: LineEditorState,
	chars: string[],
	cursor: number,
): LineEditorState => ({ ...state, chars, cursor, historyIndex: null });

const insert = (state: LineEditorState, text: string): LineEditorState => {
	const added = graphemes(text);
	if (!added.length) return state;
	return edited(
		state,
		[
			...state.chars.slice(0, state.cursor),
			...added,
			...state.chars.slice(state.cursor),
		],
		state.cursor + added.length,
	);
};

/** Deletes `from`–`to` (within the line). */
const remove = (
	state: LineEditorState,
	from: number,
	to: number,
): LineEditorState => {
	const start = Math.max(0, from);
	const end = Math.min(state.chars.length, to);
	if (start >= end) return state;
	return edited(
		state,
		[...state.chars.slice(0, start), ...state.chars.slice(end)],
		start,
	);
};

/** Cuts `from`–`to`, keeping it for Ctrl+Y. */
const kill = (
	state: LineEditorState,
	from: number,
	to: number,
): LineEditorState => {
	if (from === to) return state;
	return {
		...edited(
			state,
			[...state.chars.slice(0, from), ...state.chars.slice(to)],
			from,
		),
		killed: state.chars.slice(from, to).join(""),
	};
};

const showEntry = (
	state: LineEditorState,
	index: number | null,
	chars: string[],
): LineEditorState => ({
	...state,
	chars,
	cursor: chars.length,
	historyIndex: index,
});

const browseHistory = (
	state: LineEditorState,
	direction: "up" | "down",
	history: readonly string[],
): LineEditorState => {
	if (!history.length) return state;
	const index = state.historyIndex;
	if (index === null) {
		if (direction === "down") return state;
		const draft = state.chars;
		const last = history.length - 1;
		return {
			...showEntry(state, last, graphemes(history[last] ?? "")),
			draft,
		};
	}
	if (direction === "up") {
		const previous = Math.max(0, Math.min(index, history.length) - 1);
		return showEntry(state, previous, graphemes(history[previous] ?? ""));
	}
	if (index >= history.length - 1) return showEntry(state, null, state.draft);
	return showEntry(state, index + 1, graphemes(history[index + 1] ?? ""));
};

/** The newest entry at `from` or before that has `query` in it. */
const findBack = (
	history: readonly string[],
	query: string,
	from: number,
): number | null => {
	for (let index = Math.min(from, history.length - 1); index >= 0; index -= 1) {
		if ((history[index] ?? "").includes(query)) return index;
	}
	return null;
};

/** The search's line becomes the line being edited. */
const acceptSearch = (
	state: LineEditorState,
	history: readonly string[],
): LineEditorState => {
	const view = lineEditorView(state, history);
	return {
		...state,
		chars: view.chars,
		cursor: view.cursor,
		historyIndex: null,
		search: null,
	};
};

const searchKey = (
	state: LineEditorState,
	key: TerminalKey,
	context: LineEditorContext,
): Result | null => {
	const search = state.search as LineEditorSearch;
	const { history } = context;
	const research = (query: string, from: number): Result => {
		const match = query ? findBack(history, query, from) : null;
		return done({
			...state,
			search: {
				...search,
				query,
				match: match ?? (query ? search.match : null),
				failed: Boolean(query) && match === null,
			},
		});
	};
	if (key.type === "text" || key.type === "paste") {
		const query = search.query + stripControls(key.text).replace(/\n/g, " ");
		return research(query, search.match ?? history.length - 1);
	}
	if (key.name === "backspace" && !key.alt && !key.ctrl) {
		const query = graphemes(search.query).slice(0, -1).join("");
		return research(query, history.length - 1);
	}
	if (key.ctrl && key.name === "r") {
		if (!search.query) return done(state);
		return research(search.query, (search.match ?? history.length) - 1);
	}
	if (key.ctrl && key.name === "g") {
		return done({
			...state,
			chars: search.original.chars,
			cursor: search.original.cursor,
			search: null,
		});
	}
	if (key.name === "escape") return done(acceptSearch(state, history));
	// Any other key takes the line found, then does what it does.
	return null;
};

/** Whether Enter continues the line: after a `\`, or in an open quote. */
const continues = (line: string): boolean =>
	/(^|[^\\])(\\\\)*\\$/.test(line) || completionWord(line).quote !== null;

/** The next state for one key, and what it asks for. */
export const editLine = (
	state: LineEditorState,
	key: TerminalKey,
	context: LineEditorContext,
): Result => {
	if (state.search) {
		const handled = searchKey(state, key, context);
		if (handled) return handled;
		return editLine(acceptSearch(state, context.history), key, context);
	}
	if (key.type === "text") return done(insert(state, stripControls(key.text)));
	if (key.type === "paste") return paste(state, key.text, context);

	const { chars, cursor } = state;
	const line = lineText(state);
	const { ctrl, alt } = key;
	switch (key.name) {
		case "enter":
			if (!context.stdin && continues(line)) return done(insert(state, "\n"));
			return done(emptyLineEditor(state.killed), { type: "submit", line });
		case "backspace":
			if (ctrl || alt)
				return done(kill(state, wordStart(chars, cursor), cursor));
			return done(remove(state, cursor - 1, cursor));
		case "delete":
			if (ctrl) return done(kill(state, cursor, wordEnd(chars, cursor)));
			return done(remove(state, cursor, cursor + 1));
		case "left":
			return done({
				...state,
				cursor:
					ctrl || alt ? wordStart(chars, cursor) : Math.max(0, cursor - 1),
			});
		case "right":
			return done({
				...state,
				cursor:
					ctrl || alt
						? wordEnd(chars, cursor)
						: Math.min(chars.length, cursor + 1),
			});
		case "home":
			return done({ ...state, cursor: 0 });
		case "end":
			return done({ ...state, cursor: chars.length });
		case "up":
		case "down":
			if (context.stdin) return done(state);
			return done(browseHistory(state, key.name, context.history));
		case "pageup":
		case "pagedown":
			return done(state, {
				type: "scroll",
				pages: key.name === "pageup" ? -1 : 1,
			});
		case "tab":
			if (key.shift) return done(state);
			return done(state, {
				type: "complete",
				before: chars.slice(0, cursor).join(""),
				after: chars.slice(cursor).join(""),
			});
	}
	if (alt) return altKey(state, key.name, context);
	if (ctrl) return ctrlKey(state, key.name, context);
	return done(state);
};

const ctrlKey = (
	state: LineEditorState,
	name: string,
	context: LineEditorContext,
): Result => {
	const { chars, cursor } = state;
	switch (name) {
		case "a":
			return done({ ...state, cursor: 0 });
		case "e":
			return done({ ...state, cursor: chars.length });
		case "b":
			return done({ ...state, cursor: Math.max(0, cursor - 1) });
		case "f":
			return done({ ...state, cursor: Math.min(chars.length, cursor + 1) });
		case "h":
			return done(remove(state, cursor - 1, cursor));
		case "d":
			if (!chars.length) return done(state, { type: "eof" });
			return done(remove(state, cursor, cursor + 1));
		case "u":
			return done(kill(state, 0, cursor));
		case "k":
			return done(kill(state, cursor, chars.length));
		case "w":
			return done(kill(state, spaceWordStart(chars, cursor), cursor));
		case "y":
			return done(insert(state, state.killed));
		case "t": {
			// Swaps the two characters before the cursor (at the end) or around it.
			if (chars.length < 2 || cursor === 0) return done(state);
			const at = cursor === chars.length ? cursor - 1 : cursor;
			const next = [...chars];
			[next[at - 1], next[at]] = [next[at] as string, next[at - 1] as string];
			return done(edited(state, next, Math.min(chars.length, at + 1)));
		}
		case "c":
			return done(emptyLineEditor(state.killed), {
				type: "interrupt",
				line: lineText(state),
			});
		case "l":
			return done(state, { type: "clearScreen" });
		case "p":
		case "n":
			if (context.stdin) return done(state);
			return done(
				browseHistory(state, name === "p" ? "up" : "down", context.history),
			);
		case "r":
			if (context.stdin) return done(state);
			return done({
				...state,
				search: {
					query: "",
					match: null,
					failed: false,
					original: { chars, cursor },
				},
			});
	}
	return done(state);
};

const altKey = (
	state: LineEditorState,
	name: string,
	context: LineEditorContext,
): Result => {
	const { chars, cursor } = state;
	switch (name) {
		case "b":
			return done({ ...state, cursor: wordStart(chars, cursor) });
		case "f":
			return done({ ...state, cursor: wordEnd(chars, cursor) });
		case "d":
			return done(kill(state, cursor, wordEnd(chars, cursor)));
		case ".": {
			// The last word of the command before.
			const last = context.history.at(-1)?.trim().split(/\s+/).at(-1);
			return done(last ? insert(state, last) : state);
		}
	}
	return done(state);
};

/**
 * A paste goes in as it is, newlines too: the line runs once Enter is
 * pressed. Into a running command, each line is typed on its own, the way a
 * terminal hands lines to a program.
 */
const paste = (
	state: LineEditorState,
	raw: string,
	context: LineEditorContext,
): Result => {
	let text = stripControls(raw.replace(/\r\n?/g, "\n"));
	if (!context.stdin) {
		// The newline copied with the last line does not run it.
		text = text.replace(/\n$/, "");
		return done(insert(state, text));
	}
	const before = state.chars.slice(0, state.cursor).join("");
	const after = state.chars.slice(state.cursor).join("");
	const lines = `${before}${text}${after}`.split("\n");
	const rest = lines.pop() ?? "";
	const chars = graphemes(rest);
	return done(
		edited(state, chars, Math.max(0, chars.length - graphemes(after).length)),
		...lines.map((line) => ({ type: "submit" as const, line })),
	);
};
