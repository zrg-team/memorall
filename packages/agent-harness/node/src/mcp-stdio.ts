import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertJsonValue } from "@memorall/agent-harness-core";
import { normalizeToolInputSchema, type McpCallResult, type McpToolDescriptor, type McpToolService } from "@memorall/agent-harness-mcp";

export interface McpStdioServerConfig extends StdioServerParameters { readonly id: string }

export interface McpStdioExitInfo { readonly error?: Error }

export interface McpStdioClientOptions {
  readonly name?: string;
  readonly version?: string;
  /** Defaults to true, matching the HTTP client's `${serverId}__${tool}` rule. */
  readonly prefixToolNames?: boolean;
  /** Same escape hatch as `McpClientManagerOptions.jsonSchemaValidator`. */
  readonly jsonSchemaValidator?: ConstructorParameters<typeof Client>[1] extends { jsonSchemaValidator?: infer V } ? V : never;
  /**
   * Budget for spawn plus the initialize handshake. A first `npx -y` run
   * downloads the package before the server can answer, which routinely takes
   * longer than the SDK's 60 s request default.
   */
  readonly connectTimeoutMs?: number;
  /** Default budget for a tool call or a tools/list page. */
  readonly requestTimeoutMs?: number;
  /** Receives the server's stderr. Setting it pipes stderr instead of inheriting it. */
  readonly onStderr?: (serverId: string, chunk: string) => void;
  /** Called once when a connected server's process goes away, for whatever reason. */
  readonly onExit?: (serverId: string, info: McpStdioExitInfo) => void;
}

/**
 * On Windows a `.cmd` shim (`npx.cmd`) runs through `cmd.exe`, so ending the
 * pid the SDK knows about ends the shell and leaves the real server running.
 * The tree has to be walked while that shell is still alive.
 */
const killWindowsProcessTree = (pid: number): Promise<void> =>
  new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("exit", () => resolve());
    killer.once("error", () => resolve());
  });

interface Connection { readonly client: Client; readonly transport: StdioClientTransport; connected: boolean; closing: boolean }

export class McpStdioClientManager implements McpToolService {
  readonly #configs = new Map<string, McpStdioServerConfig>();
  readonly #connections = new Map<string, Connection>();
  readonly #pending = new Map<string, Promise<Connection>>();
  readonly #options: McpStdioClientOptions;

  constructor(configs: readonly McpStdioServerConfig[], options: McpStdioClientOptions = {}) {
    this.#options = options;
    for (const config of configs) {
      if (this.#configs.has(config.id)) throw new Error(`Duplicate MCP stdio server: ${config.id}`);
      this.#configs.set(config.id, config);
    }
  }

  async connect(id: string): Promise<Client> {
    return (await this.#connection(id)).client;
  }

  /** The server's pid, or null when it is not running. */
  pid(id: string): number | null {
    return this.#connections.get(id)?.transport.pid ?? null;
  }

  #connection(id: string): Promise<Connection> {
    const existing = this.#connections.get(id);
    if (existing) return Promise.resolve(existing);
    const pending = this.#pending.get(id);
    if (pending) return pending;
    const opening = this.#open(id).finally(() => this.#pending.delete(id));
    this.#pending.set(id, opening);
    return opening;
  }

  async #open(id: string): Promise<Connection> {
    const config = this.#configs.get(id);
    if (!config) throw new Error(`MCP stdio server is not configured: ${id}`);
    const { id: _id, ...parameters } = config;
    const { onStderr, onExit } = this.#options;
    const transport = new StdioClientTransport({ ...parameters, ...(onStderr ? { stderr: "pipe" as const } : {}) });
    if (onStderr) transport.stderr?.on("data", (chunk: Buffer | string) => onStderr(id, chunk.toString()));
    const client = new Client({ name: this.#options.name ?? "agent-harness-node", version: this.#options.version ?? "0.1.0" }, {
      capabilities: { roots: {} },
      jsonSchemaValidator: this.#options.jsonSchemaValidator ?? new CfWorkerJsonSchemaValidator(),
    });
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [] }));
    const connection: Connection = { client, transport, connected: false, closing: false };
    let lastError: Error | undefined;
    client.onerror = (error) => { lastError = error; };
    client.onclose = () => {
      if (this.#connections.get(id) === connection) this.#connections.delete(id);
      // A server that never finished starting is reported by connect() rejecting,
      // not a second time as an exit.
      if (connection.connected && !connection.closing) onExit?.(id, lastError ? { error: lastError } : {});
    };
    try {
      await client.connect(transport, this.#options.connectTimeoutMs === undefined ? undefined : { timeout: this.#options.connectTimeoutMs });
    } catch (error) {
      connection.closing = true;
      await this.#terminate(connection);
      throw error;
    }
    connection.connected = true;
    this.#connections.set(id, connection);
    return connection;
  }

  async discover(serverIds: readonly string[] = [...this.#configs.keys()]): Promise<McpToolDescriptor[]> {
    const prefix = this.#options.prefixToolNames ?? true;
    const output: McpToolDescriptor[] = [];
    for (const id of serverIds) {
      const client = await this.connect(id);
      let cursor: string | undefined;
      do {
        const result = await client.listTools(cursor ? { cursor } : undefined, this.#requestOptions());
        output.push(...result.tools.map((tool) => ({
          serverId: id,
          name: tool.name,
          exposedName: prefix ? `${id}__${tool.name}` : tool.name,
          title: tool.title ?? tool.annotations?.title,
          description: tool.description ?? `MCP tool ${tool.name} from ${id}`,
          inputSchema: normalizeToolInputSchema(tool.inputSchema as Record<string, unknown>),
          outputSchema: tool.outputSchema,
          icons: tool.icons?.map(({ src, mimeType, sizes }) => ({ src, mimeType, sizes })),
          annotations: tool.annotations,
          metadata: { source: "mcp", transport: "stdio", serverId: id, originalToolName: tool.name },
        })));
        cursor = result.nextCursor;
      } while (cursor);
    }
    return output;
  }

  async call(serverId: string, toolName: string, input: Readonly<Record<string, unknown>>, options: { signal?: AbortSignal; deadlineMs?: number; timeoutMs?: number } = {}): Promise<McpCallResult> {
    const client = await this.connect(serverId);
    const timeout = options.timeoutMs ?? (options.deadlineMs === undefined ? undefined : Math.max(0, options.deadlineMs - Date.now()));
    const result = await client.callTool({ name: toolName, arguments: { ...input } }, undefined, {
      ...this.#requestOptions(timeout),
      signal: options.signal,
      // A long job that reports progress is working, not hung.
      resetTimeoutOnProgress: true,
    });
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

  #requestOptions(timeout = this.#options.requestTimeoutMs): { timeout?: number } {
    return timeout === undefined ? {} : { timeout };
  }

  /** Stops one server, or every server when no id is given. */
  async close(serverId?: string): Promise<void> {
    const ids = serverId === undefined ? [...this.#connections.keys()] : [serverId];
    await Promise.all(ids.map(async (id) => {
      const connection = this.#connections.get(id);
      if (!connection) return;
      connection.closing = true;
      this.#connections.delete(id);
      await this.#terminate(connection);
    }));
  }

  async #terminate(connection: Connection): Promise<void> {
    const pid = connection.transport.pid;
    if (process.platform === "win32" && pid !== null) await killWindowsProcessTree(pid);
    // Elsewhere the SDK closes stdin, then escalates to SIGTERM and SIGKILL.
    await connection.client.close().catch(() => undefined);
  }
}
