/**
 * Turns a push-based source (postMessage callbacks, job progress) into an
 * async iterator without polling.
 */
export class AsyncEventQueue<T> implements AsyncIterableIterator<T> {
	private readonly buffer: T[] = [];
	private waiter: {
		resolve: (result: IteratorResult<T>) => void;
		reject: (error: unknown) => void;
	} | null = null;
	private ended = false;
	private failure: { error: unknown } | null = null;

	push(value: T): void {
		if (this.ended) return;
		if (this.waiter) {
			const { resolve } = this.waiter;
			this.waiter = null;
			resolve({ value, done: false });
			return;
		}
		this.buffer.push(value);
	}

	end(): void {
		if (this.ended) return;
		this.ended = true;
		if (this.waiter && this.buffer.length === 0) {
			const { resolve } = this.waiter;
			this.waiter = null;
			resolve({ value: undefined, done: true });
		}
	}

	fail(error: unknown): void {
		if (this.ended) return;
		this.failure = { error };
		this.ended = true;
		if (this.waiter) {
			const { reject } = this.waiter;
			this.waiter = null;
			reject(error);
		}
	}

	next(): Promise<IteratorResult<T>> {
		if (this.buffer.length > 0) {
			return Promise.resolve({ value: this.buffer.shift() as T, done: false });
		}
		if (this.failure) {
			return Promise.reject(this.failure.error);
		}
		if (this.ended) {
			return Promise.resolve({ value: undefined, done: true });
		}
		return new Promise((resolve, reject) => {
			this.waiter = { resolve, reject };
		});
	}

	return(): Promise<IteratorResult<T>> {
		this.ended = true;
		this.buffer.length = 0;
		return Promise.resolve({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		return this;
	}
}
