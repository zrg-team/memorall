/**
 * The terminal pi's TUI draws on inside the Memon machine.
 *
 * pi writes escape sequences as if to a real tty; this keeps them in a log
 * that xterm.js views read by cursor, wherever they run. A view that attaches
 * late asks for a full redraw, and the log restarts there so the view can
 * replay it onto a cleared screen. Input arrives as raw key data and goes
 * through pi-tui's StdinBuffer, like pi's ProcessTerminal does with stdin.
 */
import { StdinBuffer, type Terminal } from "../tui";

const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07";
const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0;\x07";

/** Past this much buffered output the log is compacted with a full redraw. */
const MAX_LOG_CHARS = 2_000_000;

export interface TerminalRead {
	/** Output after the cursor the view asked for. */
	data: string;
	/** Pass back on the next read. */
	cursor: number;
	/** The view's cursor fell out of the log: clear the screen first. */
	reset: boolean;
}

export class StreamTerminal implements Terminal {
	private inputHandler?: (data: string) => void;
	private resizeHandler?: () => void;
	private stdinBuffer?: StdinBuffer;
	private cols: number;
	private height: number;
	private chunks: string[] = [];
	/** Absolute position of the first character still in the log. */
	private logStart = 0;
	/** Absolute position just past the last character written. */
	private logEnd = 0;
	private waiters = new Set<() => void>();
	private progress = false;
	title = "";
	/** Asked when the log grew too large; the owner forces a full redraw. */
	onCompactRequest?: () => void;
	/** Called when the working indicator (OSC 9;4) turns on or off. */
	onProgressChange?: (active: boolean) => void;

	constructor(columns = 100, rows = 30) {
		this.cols = columns;
		this.height = rows;
	}

	get kittyProtocolActive(): boolean {
		return false;
	}

	get columns(): number {
		return this.cols;
	}

	get rows(): number {
		return this.height;
	}

	get working(): boolean {
		return this.progress;
	}

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;
		this.stdinBuffer = new StdinBuffer({ timeout: 10 });
		// Forward individual sequences to the input handler
		this.stdinBuffer.on("data", (sequence) => this.inputHandler?.(sequence));
		// Re-wrap paste content with bracketed paste markers for existing editor handling
		this.stdinBuffer.on("paste", (content) =>
			this.inputHandler?.(`\x1b[200~${content}\x1b[201~`),
		);
		// Enable bracketed paste mode - xterm.js will wrap pastes in \x1b[200~ ... \x1b[201~
		this.write("\x1b[?2004h");
	}

	stop(): void {
		if (this.progress) this.setProgress(false);
		this.write("\x1b[?2004l");
		this.stdinBuffer?.destroy();
		this.stdinBuffer = undefined;
		this.inputHandler = undefined;
		this.resizeHandler = undefined;
	}

	async drainInput(): Promise<void> {}

	/** Raw key data from a view. */
	input(data: string): void {
		this.stdinBuffer?.process(data);
	}

	/** A view's size. Returns true when it changed. */
	resize(columns: number, rows: number): boolean {
		const cols = Math.max(20, Math.floor(columns));
		const height = Math.max(5, Math.floor(rows));
		if (cols === this.cols && height === this.height) return false;
		this.cols = cols;
		this.height = height;
		this.resizeHandler?.();
		return true;
	}

	write(data: string): void {
		if (!data) return;
		this.chunks.push(data);
		this.logEnd += data.length;
		for (const wake of this.waiters) wake();
		this.waiters.clear();
		if (this.logEnd - this.logStart > MAX_LOG_CHARS) this.onCompactRequest?.();
	}

	/** Drop everything written so far; the next write starts a clean replay. */
	restartLog(): number {
		this.chunks = [];
		this.logStart = this.logEnd;
		return this.logStart;
	}

	/** Output after `cursor`, waiting up to `waitMs` for some to arrive. */
	async read(
		cursor: number,
		waitMs = 0,
		signal?: AbortSignal,
	): Promise<TerminalRead> {
		if (cursor >= this.logEnd && waitMs > 0 && !signal?.aborted) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(done, waitMs);
				function done() {
					clearTimeout(timer);
					resolve();
				}
				this.waiters.add(done);
				signal?.addEventListener("abort", done, { once: true });
			});
		}
		const reset = cursor < this.logStart || cursor > this.logEnd;
		const from = reset ? this.logStart : cursor;
		const all = this.chunks.join("");
		this.chunks = all ? [all] : [];
		return {
			data: all.slice(from - this.logStart),
			cursor: this.logEnd,
			reset,
		};
	}

	/** Wake every waiting read (the session is closing). */
	release(): void {
		for (const wake of this.waiters) wake();
		this.waiters.clear();
	}

	moveBy(lines: number): void {
		if (lines > 0) {
			// Move down
			this.write(`\x1b[${lines}B`);
		} else if (lines < 0) {
			// Move up
			this.write(`\x1b[${-lines}A`);
		}
		// lines === 0: no movement
	}

	hideCursor(): void {
		this.write("\x1b[?25l");
	}

	showCursor(): void {
		this.write("\x1b[?25h");
	}

	clearLine(): void {
		this.write("\x1b[K");
	}

	clearFromCursor(): void {
		this.write("\x1b[J");
	}

	clearScreen(): void {
		this.write("\x1b[2J\x1b[H"); // Clear screen and move to home (1,1)
	}

	setTitle(title: string): void {
		this.title = title;
		// OSC 0;title BEL - set terminal window title
		this.write(`\x1b]0;${title}\x07`);
	}

	setProgress(active: boolean): void {
		if (active === this.progress) return;
		this.progress = active;
		this.write(
			active
				? TERMINAL_PROGRESS_ACTIVE_SEQUENCE
				: TERMINAL_PROGRESS_CLEAR_SEQUENCE,
		);
		this.onProgressChange?.(active);
	}
}
