import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertJsonValue } from "@memorall/agent-harness-core";
import type { McpCallResult, McpToolDescriptor, McpToolService } from "./contracts.js";
import { createMcpHttpTransport, type McpHttpServerConfig } from "./http-transport.js";

export interface McpClientManagerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly prefixToolNames?: boolean;
}

export class McpClientManager implements McpToolService {
  readonly #clients = new Map<string, Client>();
  readonly #configs = new Map<string, McpHttpServerConfig>();
  readonly #options: McpClientManagerOptions;

  constructor(servers: readonly McpHttpServerConfig[], options: McpClientManagerOptions = {}) {
    this.#options = options;
    for (const server of servers) {
      if (this.#configs.has(server.id)) throw new Error(`Duplicate MCP server ID: ${server.id}`);
      new URL(server.url);
      this.#configs.set(server.id, server);
    }
  }

  async connect(serverId: string): Promise<Client> {
    const existing = this.#clients.get(serverId);
    if (existing) return existing;
    const config = this.#configs.get(serverId);
    if (!config) throw new Error(`MCP server is not configured: ${serverId}`);
    const client = new Client(
      { name: this.#options.name ?? "agent-harness", version: this.#options.version ?? "0.1.0" },
      { capabilities: { roots: {} }, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
    await client.connect(createMcpHttpTransport(config, this.#options.fetch));
    this.#clients.set(serverId, client);
    return client;
  }

  async discover(serverIds: readonly string[] = [...this.#configs.keys()]): Promise<McpToolDescriptor[]> {
    const descriptors: McpToolDescriptor[] = [];
    const names = new Set<string>();
    for (const serverId of serverIds) {
      const client = await this.connect(serverId);
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) {
          const exposedName = this.#options.prefixToolNames ? `${serverId}__${tool.name}` : tool.name;
          if (names.has(exposedName)) throw new Error(`Duplicate MCP tool name: ${exposedName}`);
          names.add(exposedName);
          descriptors.push({
            serverId,
            name: tool.name,
            exposedName,
            title: tool.title ?? tool.annotations?.title,
            description: tool.description ?? `MCP tool ${tool.name} from ${serverId}`,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            icons: tool.icons?.map(({ src, mimeType, sizes }) => ({ src, mimeType, sizes })),
            annotations: tool.annotations,
            metadata: { source: "mcp", serverId, originalToolName: tool.name },
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
    }
    return descriptors;
  }

  async call(
    serverId: string,
    toolName: string,
    input: Readonly<Record<string, unknown>>,
    options: { signal?: AbortSignal; deadlineMs?: number } = {},
  ): Promise<McpCallResult> {
    const client = await this.connect(serverId);
    const timeout = options.deadlineMs === undefined || !this.#options.now
      ? undefined
      : Math.max(0, options.deadlineMs - this.#options.now());
    const result = await client.callTool(
      { name: toolName, arguments: { ...input } },
      undefined,
      { signal: options.signal, ...(timeout === undefined ? {} : { timeout }) },
    );
    if (!("content" in result)) {
      const task = { type: "task", result: result.toolResult };
      assertJsonValue(task, "MCP task result");
      return { content: [task] };
    }
    assertJsonValue(result.content, "MCP content");
    if (result.structuredContent !== undefined) assertJsonValue(result.structuredContent, "MCP structured content");
    if (result._meta !== undefined) assertJsonValue(result._meta, "MCP metadata");
    return {
      content: result.content as unknown as readonly import("@memorall/agent-harness-core").JsonValue[],
      structuredContent: result.structuredContent,
      meta: result._meta,
      isError: typeof result.isError === "boolean" ? result.isError : undefined,
    };
  }

  async close(serverId?: string): Promise<void> {
    if (serverId) {
      await this.#clients.get(serverId)?.close();
      this.#clients.delete(serverId);
      return;
    }
    await Promise.all([...this.#clients.values()].map((client) => client.close()));
    this.#clients.clear();
  }
}
