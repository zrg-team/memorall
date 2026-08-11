import type { JsonValue } from "./json.js";

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | readonly JsonValue[] | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  model?: string;
  messages: readonly ModelMessage[];
  tools?: readonly ModelToolDefinition[];
  parallelToolCalls?: boolean;
  signal?: AbortSignal;
}

export type ModelStreamEvent =
  | { type: "text.delta"; text: string }
  | { type: "tool.delta"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; totalTokens: number }
  | { type: "completed"; message: ModelMessage };

export interface ModelService {
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
