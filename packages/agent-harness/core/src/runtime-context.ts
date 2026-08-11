export class RunContext {
  readonly #values = new Map<string, unknown>();

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.#values.set(key, value);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.#values.set(key, value);
  }

  has(key: string): boolean {
    return this.#values.has(key);
  }

  delete(key: string): void {
    this.#values.delete(key);
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(this.#values));
  }
}
