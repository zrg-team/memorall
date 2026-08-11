import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
	JsonSchemaType,
	JsonSchemaValidator,
	jsonSchemaValidator,
} from "@modelcontextprotocol/sdk/validation/types.js";
import type {
	MCPReconnectConfig,
	StreamableHTTPConnection,
} from "@/services/flows-legacy/utils/langchain-mcp-adapter/types";

type BrowserTransport = SSEClientTransport | StreamableHTTPClientTransport;

type StoredConnection = {
	client: Client;
	transport: BrowserTransport;
	closeCallback: () => Promise<void>;
};

const browserSafeJsonSchemaValidator: jsonSchemaValidator = {
	getValidator<T>(_schema: JsonSchemaType): JsonSchemaValidator<T> {
		return (input: unknown) => ({
			valid: true as const,
			data: input as T,
			errorMessage: undefined,
		});
	},
};

const toReconnectionOptions = (reconnect?: MCPReconnectConfig) => {
	if (!reconnect) {
		return undefined;
	}

	const options = {
		initialReconnectionDelay: reconnect.delayMs ?? 1_000,
		maxReconnectionDelay: reconnect.delayMs ?? 30_000,
		maxRetries: reconnect.maxAttempts ?? 2,
		reconnectionDelayGrowFactor: 1.5,
	};

	if (reconnect.enabled === false) {
		options.maxRetries = 0;
	}

	return options;
};

export class ConnectionManager {
	#connections = new Map<string, StoredConnection>();

	async createClient(
		type: "http" | "sse",
		serverName: string,
		options: StreamableHTTPConnection,
	): Promise<Client> {
		const existing = this.#connections.get(serverName);
		if (existing) {
			return existing.client;
		}

		const transport =
			type === "sse"
				? this.#createSSETransport(options)
				: this.#createStreamableHTTPTransport(options);

		const client = new Client(
			{
				name: "memorall-flows-legacy",
				version: "0.2.17",
			},
			{
				capabilities: {
					roots: {},
				},
				// Browser extension pages do not allow the SDK's AJV codegen path reliably.
				// We skip cached output-schema compilation in the browser adapter.
				jsonSchemaValidator: browserSafeJsonSchemaValidator,
			},
		);
		client.setRequestHandler(ListRootsRequestSchema, async () => ({
			roots: [],
		}));

		await client.connect(transport);
		this.#connections.set(serverName, {
			client,
			transport,
			closeCallback: async () => {
				await client.close();
			},
		});

		return client;
	}

	get(serverName: string): Client | undefined {
		return this.#connections.get(serverName)?.client;
	}

	has(serverName: string): boolean {
		return this.#connections.has(serverName);
	}

	getTransport(serverName: string): BrowserTransport | undefined {
		return this.#connections.get(serverName)?.transport;
	}

	async delete(serverName?: string): Promise<void> {
		if (!serverName) {
			await Promise.all(
				Array.from(this.#connections.values()).map((connection) =>
					connection.closeCallback(),
				),
			);
			this.#connections.clear();
			return;
		}

		const connection = this.#connections.get(serverName);
		if (!connection) {
			return;
		}

		await connection.closeCallback();
		this.#connections.delete(serverName);
	}

	#createStreamableHTTPTransport(
		options: StreamableHTTPConnection,
	): StreamableHTTPClientTransport {
		const transportOptions = {
			...(options.headers ? { requestInit: { headers: options.headers } } : {}),
			...(options.reconnect
				? { reconnectionOptions: toReconnectionOptions(options.reconnect) }
				: {}),
		};

		return new StreamableHTTPClientTransport(
			new URL(options.url),
			transportOptions,
		);
	}

	#createSSETransport(options: StreamableHTTPConnection): SSEClientTransport {
		const transportOptions: ConstructorParameters<
			typeof SSEClientTransport
		>[1] = {};

		if (options.headers) {
			transportOptions.eventSourceInit = {
				fetch: async (url, init) => {
					const headers = new Headers(init?.headers);
					for (const [key, value] of Object.entries(options.headers ?? {})) {
						headers.set(key, value);
					}
					headers.set("Accept", "text/event-stream");
					return fetch(url, {
						...init,
						headers,
					});
				},
			};
			transportOptions.requestInit = { headers: options.headers };
		}

		return new SSEClientTransport(new URL(options.url), transportOptions);
	}
}
