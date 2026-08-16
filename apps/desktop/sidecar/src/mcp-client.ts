export interface McpContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface McpToolResult {
	content?: McpContentBlock[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: string | number | null;
	result?: unknown;
	error?: { code?: number; message?: string; data?: unknown };
}

export class McpClientError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "McpClientError";
	}
}

const joinSignals = (
	left: AbortSignal,
	right?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } => {
	if (!right) return { signal: left, dispose: () => {} };
	const controller = new AbortController();
	const abort = () => controller.abort();
	left.addEventListener("abort", abort, { once: true });
	right.addEventListener("abort", abort, { once: true });
	if (left.aborted || right.aborted) controller.abort();
	return {
		signal: controller.signal,
		dispose: () => {
			left.removeEventListener("abort", abort);
			right.removeEventListener("abort", abort);
		},
	};
};

const parseEventStream = (body: string): JsonRpcResponse => {
	const payloads = body
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter((line) => line.length > 0 && line !== "[DONE]");
	for (let index = payloads.length - 1; index >= 0; index -= 1) {
		try {
			return JSON.parse(payloads[index] ?? "") as JsonRpcResponse;
		} catch {
			// Ignore non-JSON event data and continue to the preceding event.
		}
	}
	throw new McpClientError(
		"MCP_INVALID_RESPONSE",
		"MCP server returned an empty event stream.",
	);
};

export class StreamableHttpMcpClient {
	private nextId = 0;
	private sessionId: string | null = null;
	private initialized = false;

	constructor(
		private readonly endpoint: string,
		private readonly token?: string,
	) {}

	async initialize(signal?: AbortSignal): Promise<void> {
		if (this.initialized) return;
		await this.request(
			"initialize",
			{
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "memorall-desktop", version: "1.0.0" },
			},
			signal,
		);
		await this.notify("notifications/initialized", {}, signal);
		this.initialized = true;
	}

	async listTools(signal?: AbortSignal): Promise<Set<string>> {
		await this.initialize(signal);
		const result = (await this.request("tools/list", {}, signal)) as {
			tools?: Array<{ name?: unknown }>;
		};
		return new Set(
			(result.tools ?? [])
				.map((tool) => tool.name)
				.filter((name): name is string => typeof name === "string"),
		);
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpToolResult> {
		await this.initialize(signal);
		const result = (await this.request(
			"tools/call",
			{ name, arguments: args },
			signal,
		)) as McpToolResult;
		if (result.isError) {
			const message = result.content?.find(
				(block) => block.type === "text",
			)?.text;
			throw new McpClientError("MCP_TOOL_ERROR", message || `${name} failed.`);
		}
		return result;
	}

	async close(signal?: AbortSignal): Promise<void> {
		if (!this.sessionId) return;
		const headers = this.headers();
		const joined = joinSignals(AbortSignal.timeout(2_000), signal);
		try {
			await fetch(this.endpoint, {
				method: "DELETE",
				headers,
				signal: joined.signal,
			});
		} finally {
			joined.dispose();
			this.sessionId = null;
			this.initialized = false;
		}
	}

	private async notify(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<void> {
		await this.post({ jsonrpc: "2.0", method, params }, signal, false);
	}

	private async request(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown> {
		const id = ++this.nextId;
		const response = await this.post(
			{ jsonrpc: "2.0", id, method, params },
			signal,
			true,
		);
		if (!response)
			throw new McpClientError(
				"MCP_INVALID_RESPONSE",
				`${method} returned no response.`,
			);
		if (response.error) {
			throw new McpClientError(
				"MCP_REQUEST_FAILED",
				response.error.message ||
					`${method} failed with JSON-RPC error ${String(response.error.code)}.`,
			);
		}
		return response.result;
	}

	private async post(
		body: Record<string, unknown>,
		signal: AbortSignal | undefined,
		expectResponse: boolean,
	): Promise<JsonRpcResponse | null> {
		const timeout = AbortSignal.timeout(30_000);
		const joined = joinSignals(timeout, signal);
		let response: Response;
		try {
			response = await fetch(this.endpoint, {
				method: "POST",
				headers: this.headers(),
				body: JSON.stringify(body),
				signal: joined.signal,
			});
		} catch (error) {
			throw new McpClientError(
				joined.signal.aborted ? "MCP_TIMEOUT" : "MCP_UNAVAILABLE",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			joined.dispose();
		}
		const responseSession = response.headers.get("mcp-session-id");
		if (responseSession) this.sessionId = responseSession;
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 1_000);
			throw new McpClientError(
				"MCP_HTTP_ERROR",
				`MCP endpoint returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
			);
		}
		if (!expectResponse || response.status === 202 || response.status === 204)
			return null;
		const text = await response.text();
		const contentType = response.headers.get("content-type") ?? "";
		try {
			return contentType.includes("text/event-stream")
				? parseEventStream(text)
				: (JSON.parse(text) as JsonRpcResponse);
		} catch (error) {
			if (error instanceof McpClientError) throw error;
			throw new McpClientError(
				"MCP_INVALID_RESPONSE",
				`MCP response was not valid JSON: ${String(error)}`,
			);
		}
	}

	private headers(): Record<string, string> {
		return {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
			...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
		};
	}
}

export const mcpText = (result: McpToolResult): string =>
	result.content?.find((block) => block.type === "text")?.text ?? "";

export const mcpImage = (
	result: McpToolResult,
): { data: string; mimeType: string } | null => {
	const block = result.content?.find(
		(candidate) =>
			candidate.type === "image" && typeof candidate.data === "string",
	);
	return block?.data
		? { data: block.data, mimeType: block.mimeType || "image/png" }
		: null;
};
