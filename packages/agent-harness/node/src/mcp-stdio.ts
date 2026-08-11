import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertJsonValue } from "@memorall/agent-harness-core";
import type { McpCallResult, McpToolDescriptor, McpToolService } from "@memorall/agent-harness-mcp";

export interface McpStdioServerConfig extends StdioServerParameters { readonly id: string }

export class McpStdioClientManager implements McpToolService {
  readonly #configs = new Map<string, McpStdioServerConfig>();
  readonly #clients = new Map<string, Client>();
  constructor(configs: readonly McpStdioServerConfig[]) {
    for (const config of configs) {
      if (this.#configs.has(config.id)) throw new Error(`Duplicate MCP stdio server: ${config.id}`);
      this.#configs.set(config.id, config);
    }
  }
  async connect(id: string): Promise<Client> {
    const existing = this.#clients.get(id);
    if (existing) return existing;
    const config = this.#configs.get(id);
    if (!config) throw new Error(`MCP stdio server is not configured: ${id}`);
    const { id: _id, ...parameters } = config;
    const client = new Client({ name: "agent-harness-node", version: "0.1.0" }, {
      capabilities: { roots: {} }, jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
    });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
    await client.connect(new StdioClientTransport(parameters));
    this.#clients.set(id, client);
    return client;
  }
  async discover(prefixToolNames = true): Promise<McpToolDescriptor[]> {
    const output: McpToolDescriptor[] = [];
    for (const id of this.#configs.keys()) {
      const client = await this.connect(id);
      let cursor: string | undefined;
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined);
        output.push(...result.tools.map((tool) => ({
          serverId: id,
          name: tool.name,
          exposedName: prefixToolNames ? `${id}__${tool.name}` : tool.name,
          title: tool.title ?? tool.annotations?.title,
          description: tool.description ?? `MCP tool ${tool.name} from ${id}`,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          icons: tool.icons,
          annotations: tool.annotations,
          metadata: { source: "mcp", transport: "stdio", serverId: id },
        })));
        cursor = result.nextCursor;
      } while (cursor);
    }
    return output;
  }
  async call(serverId: string, toolName: string, input: Readonly<Record<string, unknown>>, options: { signal?: AbortSignal; deadlineMs?: number } = {}): Promise<McpCallResult> {
    const result = await (await this.connect(serverId)).callTool({ name: toolName, arguments: { ...input } }, undefined, { signal: options.signal });
    if (!("content" in result)) {
      const content = [{ type: "task", result: result.toolResult }];
      assertJsonValue(content, "MCP stdio task result");
      return { content: content as unknown as McpCallResult["content"] };
    }
    assertJsonValue(result.content, "MCP stdio content");
    if (result.structuredContent !== undefined) assertJsonValue(result.structuredContent, "MCP stdio structured content");
    if (result._meta !== undefined) assertJsonValue(result._meta, "MCP stdio metadata");
    return {
      content: result.content as unknown as McpCallResult["content"],
      structuredContent: result.structuredContent,
      meta: result._meta,
      isError: typeof result.isError === "boolean" ? result.isError : undefined,
    };
  }
  async close(): Promise<void> {
    await Promise.all([...this.#clients.values()].map((client) => client.close()));
    this.#clients.clear();
  }
}
