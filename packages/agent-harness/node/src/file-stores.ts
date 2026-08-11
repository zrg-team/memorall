import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  HarnessCheckpoint,
  HarnessCheckpointStore,
  HarnessEvent,
  HarnessEventPage,
  HarnessEventStore,
} from "@memorall/agent-harness-core";

const readJson = async <T>(file: string): Promise<T | undefined> => {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
};

const atomicJsonWrite = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, file);
};

const safeId = (value: string): string => encodeURIComponent(value);

export class FileCheckpointStore implements HarnessCheckpointStore {
  constructor(private readonly directory: string) {}
  #file(id: string): string { return path.join(this.directory, "checkpoints", `${safeId(id)}.json`); }
  save(checkpoint: HarnessCheckpoint): Promise<void> { return atomicJsonWrite(this.#file(checkpoint.id), checkpoint); }
  load(id: string): Promise<HarnessCheckpoint | undefined> { return readJson(this.#file(id)); }
  async delete(id: string): Promise<void> { await rm(this.#file(id), { force: true }); }
}

export class FileEventStore implements HarnessEventStore {
  readonly #locks = new Map<string, Promise<void>>();
  constructor(private readonly directory: string) {}
  #file(runId: string): string { return path.join(this.directory, "events", `${safeId(runId)}.json`); }
  async append(runId: string, events: readonly HarnessEvent[]): Promise<void> {
    const prior = this.#locks.get(runId) ?? Promise.resolve();
    const next = prior.then(async () => {
      const current = await readJson<HarnessEvent[]>(this.#file(runId)) ?? [];
      await atomicJsonWrite(this.#file(runId), [...current, ...events]);
    });
    this.#locks.set(runId, next);
    try { await next; } finally { if (this.#locks.get(runId) === next) this.#locks.delete(runId); }
  }
  async read(runId: string, cursor = "0"): Promise<HarnessEventPage> {
    await this.#locks.get(runId);
    const events = await readJson<HarnessEvent[]>(this.#file(runId)) ?? [];
    const offset = Number.parseInt(cursor, 10) || 0;
    return { events: events.slice(offset), nextCursor: String(events.length) };
  }
}
