export interface MCPReconnectConfig {
	enabled?: boolean;
	maxAttempts?: number;
	delayMs?: number;
}

export interface StreamableHTTPConnection {
	transport?: "http" | "sse";
	type?: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
	reconnect?: MCPReconnectConfig;
	automaticSSEFallback?: boolean;
}

export interface BrowserMCPClientConfig {
	mcpServers?: Record<string, StreamableHTTPConnection>;
	servers?: Record<string, StreamableHTTPConnection>;
	throwOnLoadError?: boolean;
	onConnectionError?:
		| "throw"
		| "ignore"
		| ((args: { serverName: string; error: unknown }) => void);
	prefixToolNameWithServerName?: boolean;
	additionalToolNamePrefix?: string;
}

export interface LoadMcpToolsOptions {
	throwOnLoadError?: boolean;
	prefixToolNameWithServerName?: boolean;
	additionalToolNamePrefix?: string;
}
