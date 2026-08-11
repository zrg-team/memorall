export type HarnessCleanup = () => void | Promise<void>;

export class RunLifecycle {
  readonly #callbacks = new Map<string, HarnessCleanup>();
  #drained = false;

  onFinish(id: string, callback: HarnessCleanup): void {
    if (this.#drained) throw new Error("Run lifecycle is already drained");
    this.#callbacks.set(id, callback);
  }

  remove(id: string): void {
    this.#callbacks.delete(id);
  }

  async drain(): Promise<readonly unknown[]> {
    if (this.#drained) return [];
    this.#drained = true;
    const errors: unknown[] = [];
    const callbacks = [...this.#callbacks.values()].reverse();
    this.#callbacks.clear();
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }
}
