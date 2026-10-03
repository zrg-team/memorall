import { memonDisplayPath } from "@/services/memon/constants";
import type { MemonTerminalSuggestion } from "@/services/memon/terminal/terminal-commands";
import type { MemonTerminalLine } from "@/services/memon/types";

/**
 * What the Terminal writes into xterm.js: its lines with the colors a shell
 * gives them, the prompt, and the cells text takes, measured the way xterm.js
 * measures them (its default Unicode 6 widths) so the cursor lands right.
 */

export const ESC = "\x1b";
export const CSI = `${ESC}[`;
/** Pastes arrive marked (`ESC[200~` … `ESC[201~`), so newlines in them wait. */
export const BRACKETED_PASTE_ON = `${CSI}?2004h`;

export const style = {
	reset: `${CSI}0m`,
	bold: `${CSI}1m`,
	red: `${CSI}31m`,
	green: `${CSI}32m`,
	blue: `${CSI}34m`,
	dim: `${CSI}90m`,
	boldGreen: `${CSI}1;32m`,
	boldBlue: `${CSI}1;34m`,
} as const;

const paint = (code: string, text: string): string =>
	text ? `${code}${text}${style.reset}` : "";

// ── Cells ────────────────────────────────────────────────────────────────

const segmenter =
	typeof Intl !== "undefined" && "Segmenter" in Intl
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;

/** Text as the characters a user sees: an accent stays with its letter. */
export const graphemes = (text: string): string[] =>
	segmenter
		? Array.from(segmenter.segment(text), (part) => part.segment)
		: Array.from(text);

const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/** One code point's cells, as xterm.js's Unicode 6 table has them. */
const codePointWidth = (char: string): number => {
	const code = char.codePointAt(0) ?? 0;
	if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
	if (code < 0x300) return 1;
	if (ZERO_WIDTH.test(char)) return 0;
	if (
		(code >= 0x1100 && code < 0x1160) ||
		code === 0x2329 ||
		code === 0x232a ||
		(code >= 0x2e80 && code < 0xa4d0 && code !== 0x303f) ||
		(code >= 0xac00 && code < 0xd7a4) ||
		(code >= 0xf900 && code < 0xfb00) ||
		(code >= 0xfe10 && code < 0xfe1a) ||
		(code >= 0xfe30 && code < 0xfe70) ||
		(code >= 0xff00 && code < 0xff61) ||
		(code >= 0xffe0 && code < 0xffe7) ||
		(code >= 0x20000 && code <= 0x2fffd) ||
		(code >= 0x30000 && code <= 0x3fffd)
	) {
		return 2;
	}
	return 1;
};

/** The cells a character takes on screen. */
export const cellWidth = (grapheme: string): number => {
	let width = 0;
	for (const char of grapheme) width += codePointWidth(char);
	return width;
};

export const textWidth = (text: string): number =>
	graphemes(text).reduce((sum, grapheme) => sum + cellWidth(grapheme), 0);

// ── Output ───────────────────────────────────────────────────────────────

/** Escape sequences output may keep: colors, erasing and moving in a line. */
const KEPT_CSI = /^[0-9;:]*[mKGCD]$/;

/**
 * Output as it may reach the screen: colors and in-line moves stay (a
 * progress bar redraws its line), anything that would move the cursor off its
 * line, switch screens or change the terminal's modes is dropped, so the
 * prompt and the line being typed stay where the Terminal put them.
 */
export const sanitizeOutput = (text: string): string => {
	let out = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] as string;
		const code = char.charCodeAt(0);
		if (char === ESC) {
			const next = text[index + 1];
			if (next === "[") {
				let end = index + 2;
				while (end < text.length && !/[@-~]/.test(text[end] as string)) {
					end += 1;
				}
				const body = text.slice(index + 2, end + 1);
				if (KEPT_CSI.test(body)) out += `${CSI}${body}`;
				index = end;
			} else if (next === "]") {
				// OSC: kept for links (8), dropped otherwise (titles).
				let end = index + 2;
				while (
					end < text.length &&
					text[end] !== "\x07" &&
					!(text[end] === ESC && text[end + 1] === "\\")
				) {
					end += 1;
				}
				const body = text.slice(index + 2, end);
				const terminator = text[end] === "\x07" ? "\x07" : `${ESC}\\`;
				if (body.startsWith("8;")) out += `${ESC}]${body}${terminator}`;
				index = text[end] === "\x07" ? end : end + 1;
			} else {
				index += 1;
			}
			continue;
		}
		if (code < 32 && char !== "\r" && char !== "\t" && char !== "\b") continue;
		if (code === 0x7f) continue;
		out += char;
	}
	return out;
};

/** Whether output paints itself (its own colors). */
const hasColors = (text: string): boolean => text.includes(`${CSI}`);

/** The prompt, the way a shell shows it: `user@memon:~/site$ `. */
export const promptText = (cwd: string | undefined, home: string) => {
	const path = memonDisplayPath(cwd ?? "/", home);
	return {
		styled: `${paint(style.boldGreen, "user@memon")}:${paint(style.boldBlue, path)}$ `,
		plain: `user@memon:${path}$ `,
	};
};

/** Text without control characters, but its newlines and tabs. */
export const stripControls = (text: string): string =>
	Array.from(text)
		.filter((char) => {
			const code = char.charCodeAt(0);
			return (
				char === "\n" ||
				char === "\t" ||
				(code >= 32 && code !== 0x7f && !(code >= 0x80 && code < 0xa0))
			);
		})
		.join("");

/** A command's text as the screen shows it: a newline continues with `> `. */
const commandText = (text: string): string =>
	stripControls(text)
		.replace(/\t/g, " ")
		.split("\n")
		.join(`\r\n${paint(style.dim, "> ")}`);

/**
 * Lines as written to the screen. A partial line has no newline: what comes
 * next continues it, the way the program printed it. A command (and a note of
 * the Terminal's) starts on a row of its own.
 */
export const renderLines = (
	lines: readonly MemonTerminalLine[],
	home: string,
	afterPartial: boolean,
): { data: string; partial: boolean } => {
	let data = "";
	let partial = afterPartial;
	for (const line of lines) {
		const own = line.kind === "command" || line.kind === "system";
		if (own && partial) data += "\r\n";
		const text = sanitizeOutput(line.text);
		switch (line.kind) {
			case "command":
				data += `${promptText(line.cwd, home).styled}${commandText(line.text)}`;
				break;
			case "stderr":
				data += hasColors(text) ? text : paint(style.red, text);
				break;
			case "system":
				data += paint(style.dim, text);
				break;
			default:
				data += text;
		}
		partial = Boolean(line.partial) && !own;
		if (!partial) data += "\r\n";
	}
	return { data, partial };
};

/** A prompt and what was typed after it, kept on screen (Enter, Ctrl+C). */
export const renderPromptLine = (
	cwd: string,
	home: string,
	text: string,
): string => `${promptText(cwd, home).styled}${commandText(text)}\r\n`;

/** An error the Terminal reports, as a shell would print it. */
export const renderError = (message: string): string =>
	`${paint(style.red, sanitizeOutput(message).replace(/\n/g, "\r\n"))}\r\n`;

const MAX_LISTED = 120;

/**
 * Tab's matches, listed in columns the way a shell lists them: folders in
 * blue, lines run before (↺) one to a row after the names.
 */
export const renderSuggestions = (
	suggestions: readonly MemonTerminalSuggestion[],
	cols: number,
): string => {
	const names = suggestions.filter((entry) => entry.kind !== "history");
	const earlier = suggestions.filter((entry) => entry.kind === "history");
	const shown = names.slice(0, MAX_LISTED);
	let data = "";
	if (shown.length) {
		const width = Math.max(...shown.map((entry) => textWidth(entry.label))) + 2;
		const perRow = Math.max(1, Math.floor(cols / width));
		const rows = Math.ceil(shown.length / perRow);
		for (let row = 0; row < rows; row += 1) {
			let line = "";
			for (let column = 0; column < perRow; column += 1) {
				const entry = shown[column * rows + row];
				if (!entry) continue;
				const label = sanitizeOutput(entry.label);
				const pad = " ".repeat(Math.max(0, width - textWidth(label)));
				const last = (column + 1) * rows + row >= shown.length;
				line += `${entry.kind === "dir" ? paint(style.boldBlue, label) : label}${last ? "" : pad}`;
			}
			data += `${line}\r\n`;
		}
		if (names.length > shown.length) {
			data += `${paint(style.dim, `… ${names.length - shown.length} more`)}\r\n`;
		}
	}
	for (const entry of earlier) {
		data += `${paint(style.dim, `↺ ${sanitizeOutput(entry.label).replace(/\n/g, " ")}`)}\r\n`;
	}
	return data;
};

// ── The line being typed ─────────────────────────────────────────────────

/**
 * Lays out what is drawn below the output (the line being typed, its prompt,
 * lines sent but not on screen yet) cell by cell, wrapping as xterm.js wraps,
 * so the cursor can be put back where it belongs. Row 0 is the row the output
 * ends on, from column `startCol`.
 */
export class EditCanvas {
	private out = "";
	private row = 0;
	private col: number;
	private cursor: { row: number; col: number } | null = null;
	private drawn = false;

	constructor(
		private readonly cols: number,
		startCol: number,
	) {
		this.col = startCol;
	}

	/** Starts a row unless one has just started. */
	freshRow(): void {
		if (this.col > 0) this.newline();
	}

	newline(): void {
		this.out += "\r\n";
		this.row += 1;
		this.col = 0;
		this.drawn = true;
	}

	/** Text as it shows: a newline in it continues on a `> ` row. */
	text(text: string, code?: string): void {
		const parts = text.split("\n");
		parts.forEach((part, index) => {
			if (index > 0) {
				this.newline();
				this.put("> ", style.dim);
			}
			this.put(part, code);
		});
	}

	/** Already styled text, measured by `plain`. */
	styled(data: string, plain: string): void {
		this.measure(plain);
		this.out += data;
	}

	/** The cursor goes here once everything is drawn. */
	markCursor(): void {
		this.cursor = { row: this.row, col: this.col };
	}

	private put(text: string, code?: string): void {
		const shown = text.replace(/\t/g, " ");
		this.measure(shown);
		this.out += code ? paint(code, shown) : shown;
	}

	private measure(text: string): void {
		for (const grapheme of graphemes(text)) {
			const width = cellWidth(grapheme);
			if (width > 0 && this.col + width > this.cols) {
				this.row += 1;
				this.col = 0;
			}
			this.col += width;
			this.drawn = true;
		}
	}

	/**
	 * What to write, ending with the cursor in place, and the row it ends on;
	 * null when there is nothing to draw.
	 */
	finish(): { data: string; cursorRow: number } | null {
		if (!this.drawn) return null;
		let data = this.out;
		let endRow = this.row;
		let { row, col } = this.cursor ?? { row: this.row, col: this.col };
		// A full row: the cursor is at the start of the next one.
		if (col >= this.cols) {
			row += 1;
			col = 0;
		}
		if (row > endRow) {
			// That row is not there yet: a space makes it, then steps back.
			data += " \b";
			endRow = row;
		}
		if (endRow > row) data += `${CSI}${endRow - row}A`;
		data += `\r${col > 0 ? `${CSI}${col}C` : ""}`;
		return { data, cursorRow: row };
	}
}
