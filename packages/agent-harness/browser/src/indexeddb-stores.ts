import type {
  HarnessCheckpoint,
  HarnessCheckpointStore,
  HarnessEvent,
  HarnessEventPage,
  HarnessEventStore,
} from "@memorall/agent-harness-core";

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error), { once: true });
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error), { once: true });
});

export interface IndexedDbHarnessStoreOptions {
  readonly databaseName?: string;
  readonly indexedDB?: IDBFactory;
}

class HarnessDatabase {
  readonly #options: IndexedDbHarnessStoreOptions;
  #promise?: Promise<IDBDatabase>;

  constructor(options: IndexedDbHarnessStoreOptions) { this.#options = options; }

  open(): Promise<IDBDatabase> {
    if (this.#promise) return this.#promise;
    const factory = this.#options.indexedDB ?? globalThis.indexedDB;
    this.#promise = new Promise((resolve, reject) => {
      const request = factory.open(this.#options.databaseName ?? "agent-harness", 1);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains("checkpoints")) request.result.createObjectStore("checkpoints", { keyPath: "id" });
        if (!request.result.objectStoreNames.contains("events")) request.result.createObjectStore("events", { keyPath: "runId" });
      });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    return this.#promise;
  }
}

export class IndexedDbCheckpointStore implements HarnessCheckpointStore {
  readonly #database: HarnessDatabase;
  constructor(options: IndexedDbHarnessStoreOptions = {}) { this.#database = new HarnessDatabase(options); }
  async save(checkpoint: HarnessCheckpoint): Promise<void> {
    const transaction = (await this.#database.open()).transaction("checkpoints", "readwrite");
    transaction.objectStore("checkpoints").put(structuredClone(checkpoint));
    await transactionDone(transaction);
  }
  async load(id: string): Promise<HarnessCheckpoint | undefined> {
    const transaction = (await this.#database.open()).transaction("checkpoints", "readonly");
    return requestResult(transaction.objectStore("checkpoints").get(id));
  }
  async delete(id: string): Promise<void> {
    const transaction = (await this.#database.open()).transaction("checkpoints", "readwrite");
    transaction.objectStore("checkpoints").delete(id);
    await transactionDone(transaction);
  }
}

interface StoredEvents { runId: string; events: HarnessEvent[] }

export class IndexedDbEventStore implements HarnessEventStore {
  readonly #database: HarnessDatabase;
  constructor(options: IndexedDbHarnessStoreOptions = {}) { this.#database = new HarnessDatabase(options); }
  async append(runId: string, events: readonly HarnessEvent[]): Promise<void> {
    const database = await this.#database.open();
    const read = database.transaction("events", "readonly");
    const current = await requestResult<StoredEvents | undefined>(read.objectStore("events").get(runId));
    const write = database.transaction("events", "readwrite");
    write.objectStore("events").put({ runId, events: [...(current?.events ?? []), ...structuredClone(events)] });
    await transactionDone(write);
  }
  async read(runId: string, cursor = "0"): Promise<HarnessEventPage> {
    const transaction = (await this.#database.open()).transaction("events", "readonly");
    const stored = await requestResult<StoredEvents | undefined>(transaction.objectStore("events").get(runId));
    const offset = Number.parseInt(cursor, 10) || 0;
    const events = stored?.events ?? [];
    return { events: structuredClone(events.slice(offset)), nextCursor: String(events.length) };
  }
}
