import type { HarnessEvent } from "./events.js";
import type { JsonValue } from "./json.js";

export interface HarnessCheckpoint {
  contractVersion: 1;
  id: string;
  runId: string;
  graphId: string;
  graphVersion: string;
  pluginVersions: Readonly<Record<string, string>>;
  state: JsonValue;
  providerContinuations?: Readonly<Record<string, string>>;
  createdAt: number;
}

export interface HarnessCheckpointStore {
  save(checkpoint: HarnessCheckpoint): Promise<void>;
  load(id: string): Promise<HarnessCheckpoint | undefined>;
  delete(id: string): Promise<void>;
}

export interface HarnessEventPage {
  events: readonly HarnessEvent[];
  nextCursor?: string;
}

export interface HarnessEventStore {
  append(runId: string, events: readonly HarnessEvent[]): Promise<void>;
  read(runId: string, cursor?: string): Promise<HarnessEventPage>;
}
