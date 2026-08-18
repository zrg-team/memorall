import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ConnectionManager } from "@/services/flows-core/utils/langchain-mcp-adapter/connection";
import { loadMcpTools } from "@/services/flows-core/utils/langchain-mcp-adapter/tools";
import type {
	BrowserMCPClientConfig,
	LoadMcpToolsOptions,
	StreamableHTTPConnection,
} from "@/services/flows-core/utils/langchain-mcp-adapter/types";

export class MCPClientError extends Error {
	serverName?: string;

	constructor(message: string, serverName?: string) {
		super(message);
		this.name = "MCPClientError";
		this.serverName = serverName;
	}
}

const isStreamableHTTPConnection = (
	connection: unknown,
): connection is StreamableHTTPConnection => {
	if (
		typeof connection !== "object" ||
		connection === null ||
		Array.isArray(connection)
	) {
		return false;
	}

	if ("url" in connection && typeof connection.url === "string") {
		try {
			new URL(connection.url);
			return true;
		} catch {
			return false;
		}
	}

	return false;
};

const resolveClientConfig = (
	config: BrowserMCPClientConfig | Record<string, StreamableHTTPConnection>,
): {
	mcpServers: Record<string, StreamableHTTPConnection>;
	loadToolsOptions: LoadMcpToolsOptions;
	onConnectionError: BrowserMCPClientConfig["onConnectionError"] | undefined;
} => {
	if (
		"mcpServers" in config ||
		"servers" in config ||
		"throwOnLoadError" in config ||
		"onConnectionError" in config
	) {
		const typedConfig = config as BrowserMCPClientConfig;

		const resolvedServers = (typedConfig.mcpServers ??
			typedConfig.servers ??
			{}) as Record<string, StreamableHTTPConnection>;
		return {
			mcpServers: resolvedServers,
			loadToolsOptions: {
				throwOnLoadError: typedConfig.throwOnLoadError,
				prefixToolNameWithServerName: typedConfig.prefixToolNameWithServerName,
				additionalToolNamePrefix: typedConfig.additionalToolNamePrefix,
			},
			onConnectionError: typedConfig.onConnectionError,
		};
	}

	return {
		mcpServers: config as Record<string, StreamableHTTPConnection>,
		loadToolsOptions: {},
		onConnectionError: undefined,
	};
};

export class MultiServerMCPClient {
	#serverNameToTools: Record<string, DynamicStructuredTool[]> = {};
	#mcpServers: Record<string, StreamableHTTPConnection>;
	#clientConnections: ConnectionManager;
	#loadToolsOptions: LoadMcpToolsOptions;
	#onConnectionError: BrowserMCPClientConfig["onConnectionError"];
	#failedServers = new Set<string>();

	constructor(
		config: BrowserMCPClientConfig | Record<string, StreamableHTTPConnection>,
	) {
		const resolvedConfig = resolveClientConfig(config);
		const servers = Object.fromEntries(
			Object.entries(resolvedConfig.mcpServers).filter(([, connection]) =>
				isStreamableHTTPConnection(connection),
			),
		);

		if (Object.keys(servers).length === 0) {
			throw new MCPClientError("No MCP servers provided");
		}

		this.#mcpServers = servers;
		this.#loadToolsOptions = resolvedConfig.loadToolsOptions;
		this.#onConnectionError = resolvedConfig.onConnectionError;
		this.#clientConnections = new ConnectionManager();
	}

	async initializeConnections(): Promise<
		Record<string, DynamicStructuredTool[]>
	> {
		for (const [serverName, connection] of Object.entries(this.#mcpServers)) {
			if (
				(this.#onConnectionError === "ignore" ||
					typeof this.#onConnectionError === "function") &&
				this.#failedServers.has(serverName)
			) {
				continue;
			}

			try {
				await this.#initializeConnection(serverName, connection);
				this.#failedServers.delete(serverName);
			} catch (error) {
				if (this.#onConnectionError === "throw" || !this.#onConnectionError) {
					throw error;
				}

				if (typeof this.#onConnectionError === "function") {
					this.#onConnectionError({ serverName, error });
				}

				this.#failedServers.add(serverName);
			}
		}

		return this.#serverNameToTools;
	}

	async getTools(serverNames: string[] = []): Promise<DynamicStructuredTool[]> {
		await this.initializeConnections();

		if (serverNames.length === 0) {
			return Object.values(this.#serverNameToTools).flat();
		}

		return serverNames.flatMap(
			(serverName) => this.#serverNameToTools[serverName] ?? [],
		);
	}

	async getClient(serverName: string): Promise<Client | undefined> {
		await this.initializeConnections();
		return this.#clientConnections.get(serverName);
	}

	async close(): Promise<void> {
		this.#serverNameToTools = {};
		this.#failedServers.clear();
		await this.#clientConnections.delete();
	}

	async #initializeConnection(
		serverName: string,
		connection: StreamableHTTPConnection,
	): Promise<void> {
		if (this.#clientConnections.has(serverName)) {
			return;
		}

		if (connection.type === "sse" || connection.transport === "sse") {
			await this.#initializeSSEConnection(serverName, connection);
			return;
		}

		await this.#initializeStreamableHTTPConnection(serverName, connection);
	}

	async #initializeStreamableHTTPConnection(
		serverName: string,
		connection: StreamableHTTPConnection,
	): Promise<void> {
		try {
			const client = await this.#clientConnections.createClient(
				"http",
				serverName,
				connection,
			);
			await this.#loadToolsForServer(serverName, client, connection);
		} catch (error) {
			const statusCode = this.#getHttpErrorCode(error);
			const shouldFallbackToSSE =
				(connection.automaticSSEFallback ?? true) &&
				statusCode !== undefined &&
				statusCode >= 400 &&
				statusCode < 500;

			if (!shouldFallbackToSSE) {
				throw new MCPClientError(
					`Failed to connect to MCP HTTP server "${serverName}": ${String(error)}`,
					serverName,
				);
			}

			try {
				await this.#initializeSSEConnection(serverName, connection);
			} catch (firstSSEError) {
				const fallbackUrl = this.#toSSEConnectionURL(connection.url);
				if (fallbackUrl !== connection.url) {
					await this.#initializeSSEConnection(serverName, {
						...connection,
						url: fallbackUrl,
					});
					return;
				}

				throw new MCPClientError(
					`Failed to connect to MCP server "${serverName}" via HTTP and SSE fallback: ${String(
						firstSSEError,
					)}`,
					serverName,
				);
			}
		}
	}

	async #initializeSSEConnection(
		serverName: string,
		connection: StreamableHTTPConnection,
	): Promise<void> {
		try {
			const client = await this.#clientConnections.createClient(
				"sse",
				serverName,
				connection,
			);
			await this.#loadToolsForServer(serverName, client, connection);
		} catch (error) {
			throw new MCPClientError(
				`Failed to connect to MCP SSE server "${serverName}": ${String(error)}`,
				serverName,
			);
		}
	}

	async #loadToolsForServer(
		serverName: string,
		client: Client,
		connection: StreamableHTTPConnection,
	): Promise<void> {
		this.#serverNameToTools[serverName] = await loadMcpTools(
			serverName,
			client,
			this.#loadToolsOptions,
			{
				url: connection.url,
				headers: connection.headers,
			},
		);
	}

	#getHttpErrorCode(error: unknown): number | undefined {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			typeof error.code === "number"
		) {
			return error.code;
		}

		const message =
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: "";
		const match = message.match(/\bHTTP (\d{3})\b/i);
		return match ? Number(match[1]) : undefined;
	}

	#toSSEConnectionURL(url: string): string {
		const parsedUrl = new URL(url);
		const pathParts = parsedUrl.pathname.split("/");
		const lastPart = pathParts.at(-1);
		if (lastPart === "mcp") {
			pathParts[pathParts.length - 1] = "sse";
			parsedUrl.pathname = pathParts.join("/");
		}
		return parsedUrl.toString();
	}
}
