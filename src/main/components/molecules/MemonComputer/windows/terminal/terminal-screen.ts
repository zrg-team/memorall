import type { MemonTerminalLine } from "@/services/memon/types";
import type { LineEditorView } from "./line-editor";
import {
	BRACKETED_PASTE_ON,
	CSI,
	EditCanvas,
	promptText,
	renderError,
	renderLines,
	renderPromptLine,
	stripControls,
} from "./terminal-text";

/** The parts of xterm.js's Terminal the screen draws with. */
export interface ScreenTerminal {
	readonly cols: number;
	readonly buffer: { readonly active: { readonly cursorX: number } };
	write(data: string, callback?: () => void): void;
	reset(): void;
}

/** The tab in front: its lines, as the machine keeps them. */
export interface ScreenSource {
	/** The tab and its screen: another one is drawn anew. */
	key: string;
	lines: readonly MemonTerminalLine[];
	/** The screen's number of `lines[0]`. */
	offset: number;
}

/** The line being typed, and what goes before it. */
export interface ScreenInput {
	/** The prompt's directory; null while a command runs and takes the line. */
	promptCwd: string | null;
	view: LineEditorView;
}

/** A line sent but not on screen yet. */
interface Echo {
	id: number;
	kind: "command" | "input";
	text: string;
	cwd: string;
}

const EMPTY_INPUT: ScreenInput = {
	promptCwd: null,
	view: { label: null, chars: [], cursor: 0 },
};

/**
 * What the Terminal shows in xterm.js: the tab's lines as output, and below
 * them the line being typed, its prompt and lines just sent. New output goes
 * above the line being typed, which is then drawn again with the cursor where
 * it was, the way a shell keeps its line while a program prints.
 *
 * Writes go one at a time: where the output ends (its column) is read back
 * from xterm.js before the line is drawn after it.
 */
export class TerminalScreen {
	private source: ScreenSource | null = null;
	private input: ScreenInput = EMPTY_INPUT;
	/** The screen drawn, and its lines written so far. */
	private drawnKey: string | null = null;
	private written = 0;
	/** The output ends mid-line. */
	private partial = false;
	/** The Terminal's own text (a Tab listing, an error), to write next. */
	private local: string[] = [];
	private echoes: Echo[] = [];
	private echoSeq = 0;
	/** The column the output ends at: the line being typed starts there. */
	private startCol = 0;
	/** The cursor's row in what is drawn after the output; null: nothing is. */
	private cursorRow: number | null = null;
	private redrawAll = true;
	private writing = false;
	private again = false;
	private held = 0;
	private idleWaiters: Array<() => void> = [];
	private disposed = false;

	constructor(
		private readonly term: ScreenTerminal,
		private home: string,
	) {}

	setHome(home: string): void {
		if (home === this.home) return;
		this.home = home;
		this.redrawAll = true;
		this.update();
	}

	setSource(source: ScreenSource): void {
		this.source = source;
		this.update();
	}

	setInput(input: ScreenInput): void {
		this.input = input;
		this.update();
	}

	/** Writes the Terminal's own text, on rows of its own, above the line. */
	print(data: string): void {
		if (!data) return;
		this.local.push(data);
		this.update();
	}

	/**
	 * A line just sent (a command, or input to the running one): shown where
	 * it goes until the tab's lines have it.
	 */
	echo(kind: Echo["kind"], text: string, cwd: string): number {
		this.echoSeq += 1;
		this.echoes.push({ id: this.echoSeq, kind, text, cwd });
		this.update();
		return this.echoSeq;
	}

	/**
	 * Sending it is over: a line the tab's lines still do not have stays on
	 * screen, with the error that kept it out.
	 */
	settleEcho(id: number, error?: string): void {
		const index = this.echoes.findIndex((echo) => echo.id === id);
		let data = "";
		if (index >= 0) {
			const [echo] = this.echoes.splice(index, 1) as [Echo];
			data +=
				echo.kind === "command"
					? renderPromptLine(echo.cwd, this.home, echo.text)
					: `${stripControls(echo.text)}\r\n`;
		}
		if (error) data += renderError(error);
		if (data) this.local.push(data);
		this.update();
	}

	/** Draws everything again (the terminal's width changed). */
	redraw(): void {
		this.redrawAll = true;
		this.update();
	}

	/** Changes made inside `change` are drawn once, after it. */
	batch(change: () => void): void {
		this.held += 1;
		try {
			change();
		} finally {
			this.held -= 1;
			if (!this.held && this.again && !this.writing) {
				this.again = false;
				this.update();
			}
		}
	}

	/** Resolves once everything asked for is on screen. */
	idle(): Promise<void> {
		if (!this.writing && !this.again) return Promise.resolve();
		return new Promise((resolve) => this.idleWaiters.push(resolve));
	}

	dispose(): void {
		this.disposed = true;
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}

	private update(): void {
		if (this.disposed) return;
		if (this.writing || this.held) {
			this.again = true;
			return;
		}
		this.writing = true;
		this.flush();
	}

	private settled(): void {
		this.writing = false;
		if (this.disposed) return;
		if (this.again) {
			this.again = false;
			this.update();
			return;
		}
		for (const resolve of this.idleWaiters.splice(0)) resolve();
	}

	private flush(): void {
		let output = "";
		let reset = false;
		const source = this.source;
		if (source) {
			const end = source.offset + source.lines.length;
			if (
				this.redrawAll ||
				source.key !== this.drawnKey ||
				this.written > end
			) {
				// Another tab, a cleared screen, or a new width: drawn anew.
				if (source.key !== this.drawnKey) {
					this.echoes = [];
					this.local = [];
				}
				reset = true;
				this.term.reset();
				this.drawnKey = source.key;
				this.written = source.offset;
				this.partial = false;
				this.cursorRow = null;
				this.startCol = 0;
				this.redrawAll = false;
			}
			const fresh = source.lines.slice(
				Math.max(0, this.written - source.offset),
			);
			if (fresh.length) {
				this.matchEchoes(fresh);
				const rendered = renderLines(fresh, this.home, this.partial);
				output += rendered.data;
				this.partial = rendered.partial;
			}
			this.written = end;
		}
		for (const data of this.local.splice(0)) {
			output += `${this.partial ? "\r\n" : ""}${data}`;
			this.partial = false;
		}
		const prefix = reset ? BRACKETED_PASTE_ON : this.erase();
		if (output || reset) {
			this.term.write(`${prefix}${output}`, () => {
				if (this.disposed) return this.settled();
				this.startCol = this.term.buffer.active.cursorX;
				this.drawInput("");
			});
			return;
		}
		this.drawInput(prefix);
	}

	/** Lines the tab now has take the place of their echoes. */
	private matchEchoes(lines: readonly MemonTerminalLine[]): void {
		for (const line of lines) {
			const echo = this.echoes[0];
			if (!echo) return;
			if (
				(line.kind === "command" && line.text === echo.text.trim()) ||
				(echo.kind === "input" &&
					line.kind === "input" &&
					line.text === echo.text)
			) {
				this.echoes.shift();
			}
		}
	}

	/** Takes away what is drawn after the output, back to where it ends. */
	private erase(): string {
		const row = this.cursorRow;
		if (row === null) return "";
		this.cursorRow = null;
		if (this.startCol >= this.term.cols) {
			// The output filled its row: what was drawn starts on the next.
			this.startCol = 0;
			return `${row > 1 ? `${CSI}${row - 1}A` : ""}\r${CSI}J`;
		}
		return `${row > 0 ? `${CSI}${row}A` : ""}\r${
			this.startCol > 0 ? `${CSI}${this.startCol}C` : ""
		}${CSI}J`;
	}

	/** Draws the echoes, the prompt and the line, and puts the cursor in it. */
	private drawInput(prefix: string): void {
		const canvas = new EditCanvas(this.term.cols, this.startCol);
		for (const echo of this.echoes) {
			if (echo.kind === "command") {
				canvas.freshRow();
				const prompt = promptText(echo.cwd, this.home);
				canvas.styled(prompt.styled, prompt.plain);
			}
			canvas.text(stripControls(echo.text));
			canvas.newline();
		}
		const { promptCwd, view } = this.input;
		if (promptCwd !== null) {
			canvas.freshRow();
			if (view.label) {
				canvas.text(view.label);
			} else {
				const prompt = promptText(promptCwd, this.home);
				canvas.styled(prompt.styled, prompt.plain);
			}
		}
		canvas.text(view.chars.slice(0, view.cursor).join(""));
		canvas.markCursor();
		canvas.text(view.chars.slice(view.cursor).join(""));
		const drawn = canvas.finish();
		this.cursorRow = drawn ? drawn.cursorRow : null;
		const data = `${prefix}${drawn?.data ?? ""}`;
		if (data) this.term.write(data, () => this.settled());
		else this.settled();
	}
}
