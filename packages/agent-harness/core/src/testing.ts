import type { HarnessEvent } from "./events.js";
import type {
  HarnessCheckpoint,
  HarnessCheckpointStore,
  HarnessEventPage,
  HarnessEventStore,
} from "./persistence.js";
import type { CancelHandle, HarnessPlatform } from "./platform.js";

export class MemoryCheckpointStore implements HarnessCheckpointStore {
  readonly #values = new Map<string, HarnessCheckpoint>();
  async save(checkpoint: HarnessCheckpoint): Promise<void> {
    this.#values.set(checkpoint.id, structuredClone(checkpoint));
  }
  async load(id: string): Promise<HarnessCheckpoint | undefined> {
    const value = this.#values.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async delete(id: string): Promise<void> {
    this.#values.delete(id);
  }
}

export class MemoryEventStore implements HarnessEventStore {
  readonly #values = new Map<string, HarnessEvent[]>();
  async append(runId: string, events: readonly HarnessEvent[]): Promise<void> {
    this.#values.set(runId, [...(this.#values.get(runId) ?? []), ...structuredClone(events)]);
  }
  async read(runId: string, cursor = "0"): Promise<HarnessEventPage> {
    const start = Number.parseInt(cursor, 10) || 0;
    const events = this.#values.get(runId) ?? [];
    return { events: structuredClone(events.slice(start)), nextCursor: String(events.length) };
  }
}

export const createTestPlatform = (runtime = "test"): HarnessPlatform => {
  let sequence = 0;
  let now = 1_000;
  return {
    runtime,
    now: () => now++,
    randomUUID: () => `test-${++sequence}`,
    schedule: (delayMs, callback): CancelHandle => {
      const timer = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(timer) };
    },
    fetch: globalThis.fetch,
  };
};
