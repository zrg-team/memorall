/**
 * Helper class to buffer streaming content and emit when threshold is reached.
 */
export class StreamBuffer {
	private buffer = "";
	private wordCount = 0;
	// Counting words by re-running `trim().split(/\s+/)` over the buffer meant
	// every token rescanned and reallocated everything received since the last
	// flush. The count is a boundary count, so it can be kept incrementally.
	private lastCharWasSpace = true;
	private readonly minWords: number;
	private readonly onEmit: (content: string) => void;

	constructor(minWords: number, onEmit: (content: string) => void) {
		this.minWords = minWords;
		this.onEmit = onEmit;
	}

	add(content: string): void {
		if (!content) return;

		for (let index = 0; index < content.length; index += 1) {
			const code = content.charCodeAt(index);
			const isSpace = code === 32 || code === 10 || code === 9 || code === 13;
			if (!isSpace && this.lastCharWasSpace) this.wordCount += 1;
			this.lastCharWasSpace = isSpace;
		}

		this.buffer += content;

		if (this.wordCount >= this.minWords) {
			this.flush();
		}
	}

	flush(): void {
		if (this.buffer) {
			this.onEmit(this.buffer);
			this.buffer = "";
			this.wordCount = 0;
			this.lastCharWasSpace = true;
		}
	}

	peek(): string {
		return this.buffer;
	}
}

/**
 * Rate-bounds how often streamed content crosses a context boundary.
 *
 * Each progress update is a runtime message: a structured clone, an IPC hop and
 * a relay decision. A fast model emits those faster than any UI can use them, so
 * content is throttled — the first fragment goes out immediately
 * (time-to-first-token must not regress), and everything arriving inside the
 * window is merged into one message sent on the trailing edge.
 *
 * Anything that is not plain content — a tool call, a tool result, a finish
 * reason — is sent immediately, behind a flush of whatever content is pending,
 * so the consumer still sees events in the order they happened.
 */
export interface ChunkDispatcherOptions {
	intervalMs: number;
	sendContent: (content: string) => void | Promise<void>;
	now?: () => number;
	schedule?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	cancel?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class ChunkDispatcher {
	private pending = "";
	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastSentAt = Number.NEGATIVE_INFINITY;
	private readonly options: Required<ChunkDispatcherOptions>;

	constructor(options: ChunkDispatcherOptions) {
		this.options = {
			now: () => Date.now(),
			schedule: (fn, delayMs) => setTimeout(fn, delayMs),
			cancel: (handle) => clearTimeout(handle),
			...options,
		};
	}

	queueContent(content: string): void {
		if (!content) return;
		this.pending += content;

		const elapsed = this.options.now() - this.lastSentAt;
		if (elapsed >= this.options.intervalMs) {
			this.flush();
			return;
		}

		if (!this.timer) {
			this.timer = this.options.schedule(() => {
				this.timer = null;
				this.flush();
			}, this.options.intervalMs - elapsed);
		}
	}

	/** Emit anything pending right now. Safe to call when nothing is pending. */
	flush(): void {
		if (this.timer) {
			this.options.cancel(this.timer);
			this.timer = null;
		}
		if (!this.pending) return;

		const content = this.pending;
		this.pending = "";
		this.lastSentAt = this.options.now();
		void this.options.sendContent(content);
	}

	/** Send an out-of-band event, preserving order against buffered content. */
	send(emit: () => void | Promise<void>): void {
		this.flush();
		this.lastSentAt = this.options.now();
		void emit();
	}

	hasPending(): boolean {
		return this.pending.length > 0;
	}
}
