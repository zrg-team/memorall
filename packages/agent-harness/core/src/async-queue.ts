interface PendingRead<T> {
  resolve(value: IteratorResult<T>): void;
}

export class BoundedAsyncQueue<T> {
  readonly #values: T[] = [];
  readonly #reads: PendingRead<T>[] = [];
  readonly #spaceWaiters: Array<() => void> = [];
  #closed = false;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError("Queue capacity must be a positive integer");
    }
  }

  async push(value: T): Promise<void> {
    if (this.#closed) return;
    const pending = this.#reads.shift();
    if (pending) {
      pending.resolve({ value, done: false });
      return;
    }
    while (!this.#closed && this.#values.length >= this.capacity) {
      await new Promise<void>((resolve) => this.#spaceWaiters.push(resolve));
    }
    if (!this.#closed) this.#values.push(value);
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift();
    if (value !== undefined) {
      this.#spaceWaiters.shift()?.();
      return Promise.resolve({ value, done: false });
    }
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.#reads.push({ resolve }));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const resolve of this.#spaceWaiters.splice(0)) resolve();
    if (this.#values.length === 0) {
      for (const pending of this.#reads.splice(0)) {
        pending.resolve({ value: undefined, done: true });
      }
    }
  }
}
