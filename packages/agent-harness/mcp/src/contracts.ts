import { createServiceToken, type JsonValue } from "@memorall/agent-harness-core";

export interface McpToolDescriptor {
  readonly serverId: string;
  readonly name: string;
  readonly exposedName: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly icons?: readonly { src: string; mimeType?: string; sizes?: readonly string[] }[];
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface McpCallResult {
  readonly content: readonly JsonValue[];
  readonly structuredContent?: JsonValue;
  readonly meta?: JsonValue;
  readonly isError?: boolean;
}

export interface McpToolService {
  call(
    serverId: string,
    toolName: string,
    input: Readonly<Record<string, unknown>>,
    options?: { signal?: AbortSignal; deadlineMs?: number },
  ): Promise<McpCallResult>;
}

export const MCP_TOOL_SERVICE = createServiceToken<McpToolService>("mcp", {
  description: "Connected Model Context Protocol clients",
});
