import type { SerializedHarnessError } from "./errors.js";
import type { JsonValue } from "./json.js";
import type { ToolExecutionResult } from "./tool.js";

export interface HarnessUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type HarnessEvent =
  | { type: "run.started"; runId: string; graphId: string; timestamp: number }
  | { type: "node.started"; runId: string; nodeId: string; timestamp: number }
  | { type: "node.completed"; runId: string; nodeId: string; timestamp: number; durationMs: number }
  | { type: "model.delta"; runId: string; delta: JsonValue; timestamp: number }
  | { type: "tool.started"; runId: string; callId: string; tool: string; timestamp: number }
  | {
      type: "tool.completed";
      runId: string;
      callId: string;
      tool: string;
      result: ToolExecutionResult;
      timestamp: number;
      durationMs: number;
    }
  | { type: "usage.updated"; runId: string; usage: HarnessUsage; timestamp: number }
  | { type: "run.completed"; runId: string; result: JsonValue; timestamp: number }
  | { type: "run.failed"; runId: string; error: SerializedHarnessError; timestamp: number };

export interface HarnessEventSink {
  emit(event: HarnessEvent): Promise<void>;
}
