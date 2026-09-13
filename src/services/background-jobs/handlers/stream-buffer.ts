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

const isPromiseLike = (value: unknown): value is PromiseLike<void> =>
	typeof (value as { then?: unknown } | null | undefined)?.then === "function";

export class ChunkDispatcher {
	private pending = "";
	private timer: ReturnType<typeof setTimeout> | null = null;
	private lastSentAt = Number.NEGATIVE_INFINITY;
	private readonly options: Required<ChunkDispatcherOptions>;
	/**
	 * Every emit, chained so each starts only once the one before it has
	 * finished.
	 *
	 * Ordering the *calls* was not enough. An emit is an async progress write,
	 * and those do not take equally long: the first few of a turn have to look
	 * the job up before they can queue anything, and every later one skips that.
	 * Fired and forgotten, the later events finished first and reached the UI
	 * ahead of the early ones — so the knowledge-retrieval turn, always the
	 * earliest event, was rebuilt at the bottom of the run timeline while the
	 * saved message had it at the top.
	 */
	private tail: Promise<void> = Promise.resolve();
	/** Async emits started or waiting that have not finished yet. */
	private inFlight = 0;

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
		this.enqueue(() => this.options.sendContent(content));
	}

	/** Send an out-of-band event, preserving order against buffered content. */
	send(emit: () => void | Promise<void>): void {
		this.flush();
		this.lastSentAt = this.options.now();
		this.enqueue(emit);
	}

	/**
	 * Resolve once everything sent so far has been delivered — or once
	 * `maxWaitMs` has passed, whichever comes first.
	 *
	 * The end of a turn awaits this before sending its final result, which
	 * would otherwise be free to overtake chunks still in the queue. It is
	 * bounded because the alternative is worse than a misplaced chunk: a
	 * progress write that never settles would hold the final result forever,
	 * and the turn would never show as done. The final result also carries the
	 * complete, correctly ordered parts, so anything still queued at the
	 * deadline cannot leave the saved message wrong.
	 */
	drain(maxWaitMs = ChunkDispatcher.DEFAULT_DRAIN_MS): Promise<void> {
		this.flush();
		if (this.inFlight === 0) return Promise.resolve();
		const settled = this.tail;
		return new Promise<void>((resolve) => {
			const timer = this.options.schedule(resolve, maxWaitMs);
			void settled.then(() => {
				this.options.cancel(timer);
				resolve();
			});
		});
	}

	/** Longest the end of a turn will wait on queued progress writes. */
	static readonly DEFAULT_DRAIN_MS = 1_000;

	/**
	 * Run an emit now if nothing is still in flight, otherwise after whatever is.
	 *
	 * Queuing everything would have delayed every send by at least a microtask,
	 * and an idle dispatcher sending its first fragment straight away is what
	 * keeps streaming feeling immediate. So an emit that finishes synchronously
	 * never waits and never holds anything up; only one still running
	 * asynchronously makes the next one wait its turn.
	 */
	private enqueue(emit: () => void | Promise<void>): void {
		if (this.inFlight === 0) {
			let outcome: void | Promise<void>;
			try {
				outcome = emit();
			} catch {
				// Dropped rather than rethrown: see `track`.
				return;
			}
			if (!isPromiseLike(outcome)) return;
			this.track(outcome);
			return;
		}
		this.track(this.tail.then(() => emit()));
	}

	private track(work: PromiseLike<void>): void {
		this.inFlight += 1;
		// A failed write is dropped rather than rethrown: it must not wedge the
		// queue and silently swallow every chunk behind it.
		const settled = Promise.resolve(work).then(
			() => undefined,
			() => undefined,
		);
		this.tail = settled.finally(() => {
			this.inFlight -= 1;
		});
	}

	hasPending(): boolean {
		return this.pending.length > 0;
	}
}
