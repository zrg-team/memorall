import type { HarnessEvent, JsonValue } from "@memorall/agent-harness-core";

export interface LangGraphWriterPayload {
  type?: string;
  node?: string;
  delta?: JsonValue;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export const adaptLangGraphWriterPayload = (
  payload: LangGraphWriterPayload,
  runId: string,
  timestamp: number,
): HarnessEvent | undefined => {
  if (payload.type === "model.delta" && payload.delta !== undefined) {
    return { type: "model.delta", runId, delta: payload.delta, timestamp };
  }
  if (payload.type === "node.started" && payload.node) {
    return { type: "node.started", runId, nodeId: payload.node, timestamp };
  }
  if (payload.type === "usage.updated" && payload.usage) {
    return { type: "usage.updated", runId, usage: payload.usage, timestamp };
  }
  return undefined;
};
