import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type McpHttpTransportKind = "http" | "sse";

export interface McpReconnectOptions {
  enabled?: boolean;
  maxAttempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
}

export interface McpHttpServerConfig {
  readonly id: string;
  readonly url: string;
  readonly transport?: McpHttpTransportKind;
  readonly headers?: Readonly<Record<string, string>>;
  readonly reconnect?: McpReconnectOptions;
}

const reconnectionOptions = (options?: McpReconnectOptions) => options ? {
  initialReconnectionDelay: options.delayMs ?? 1_000,
  maxReconnectionDelay: options.maxDelayMs ?? 30_000,
  maxRetries: options.enabled === false ? 0 : options.maxAttempts ?? 2,
  reconnectionDelayGrowFactor: 1.5,
} : undefined;

export const createMcpHttpTransport = (
  config: McpHttpServerConfig,
  fetchImplementation?: typeof globalThis.fetch,
): Transport => {
  const requestInit = config.headers ? { headers: { ...config.headers } } : undefined;
  if (config.transport === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      requestInit,
      ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit,
    ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
    ...(config.reconnect ? { reconnectionOptions: reconnectionOptions(config.reconnect) } : {}),
  });
};
