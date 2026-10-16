/**
 * A terminal program's output, kept for views to replay.
 *
 * fx prints its conversation inline, into the terminal's scrollback, and has
 * no way to draw its screen again on request. So a view that attaches late
 * replays the output from the start, and the log keeps all of it: up to a
 * limit, past which it drops the oldest lines but keeps the opening sequences
 * that set the terminal's modes, so a replay still starts in the right state.
 */

/** Output kept before the oldest lines are dropped. */
const MAX_LOG_CHARS = 4_000_000;
/** What is left after dropping. */
const KEEP_CHARS = 2_000_000;

export interface OutputRead {
	/** Output after the cursor the view asked for. */
	data: string;
	/** Pass back on the next read. */
	cursor: number;
	/** The view's cursor fell out of the log: clear the screen and write `data`. */
	reset: boolean;
}

export class OutputLog {
	private chunks: string[] = [];
	/** Absolute position of the first character still in the log. */
	private start = 0;
	/** Absolute position just past the last character written. */
	private end = 0;
	/** The opening output (mode set-up), replayed even after older lines go. */
	private preamble: string | null = null;
	private waiters = new Set<() => void>();
	private readonly decoder = new TextDecoder();

	/** Bytes or text the program wrote; returns it as text. */
	write(data: Uint8Array | string): string {
		const text =
			typeof data === "string"
				? data
				: this.decoder.decode(data, { stream: true });
		if (!text) return text;
		this.chunks.push(text);
		this.end += text.length;
		if (this.end - this.start > MAX_LOG_CHARS) this.compact();
		for (const wake of this.waiters) wake();
		this.waiters.clear();
		return text;
	}

	/**
	 * Marks everything written so far as the preamble: the program is ready,
	 * and what it printed until now set the terminal up.
	 */
	markPreamble(): void {
		if (this.preamble === null) this.preamble = this.text();
	}

	/** The cursor a view that replays everything starts from. */
	get origin(): number {
		return this.start;
	}

	/** Output after `cursor`, waiting up to `waitMs` for some to arrive. */
	async read(
		cursor: number,
		waitMs = 0,
		signal?: AbortSignal,
	): Promise<OutputRead> {
		if (
			cursor >= this.end &&
			cursor >= this.start &&
			waitMs > 0 &&
			!signal?.aborted
		) {
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", done);
					this.waiters.delete(done);
					resolve();
				};
				const timer = setTimeout(done, waitMs);
				this.waiters.add(done);
				signal?.addEventListener("abort", done, { once: true });
			});
		}
		const reset = cursor < this.start || cursor > this.end;
		const from = reset ? this.start : cursor;
		return {
			data: this.text().slice(from - this.start),
			cursor: this.end,
			reset,
		};
	}

	/** Wakes every waiting read (the program is closing). */
	release(): void {
		for (const wake of this.waiters) wake();
		this.waiters.clear();
	}

	private text(): string {
		if (this.chunks.length > 1) this.chunks = [this.chunks.join("")];
		return this.chunks[0] ?? "";
	}

	private compact(): void {
		const all = this.text();
		let cut = all.length - KEEP_CHARS;
		// Start the kept part on a line, so no escape sequence is cut in two.
		const newline = all.indexOf("\n", cut);
		if (newline !== -1) cut = newline + 1;
		const kept = all.slice(cut);
		const lead = this.preamble ? `${this.preamble}\r\n` : "";
		this.chunks = [lead + kept];
		// Every view's cursor is now out of the log, so each replays it.
		this.start = this.end + 1;
		this.end = this.start + lead.length + kept.length;
	}
}
