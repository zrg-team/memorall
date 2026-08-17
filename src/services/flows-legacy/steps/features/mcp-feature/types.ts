// Browser builds only support network MCP transports.
export interface MCPHTTPServerConfig {
	type: "http";
	name: string;
	url: string;
	headers?: Record<string, string>;
}

export interface MCPSSEServerConfig {
	type: "sse";
	name: string;
	url: string;
	headers?: Record<string, string>;
}

export type MCPServerConfig = MCPHTTPServerConfig | MCPSSEServerConfig;

/** Agent-side reference into the Connections registry. */
export interface MCPConnectionSelection {
	connectionId: string;
	appIds?: string[];
	toolAllowlist?: string[];
}

export interface MCPFeatureConfig {
	/**
	 * Resolved servers. Written by the Connections resolver just before a run —
	 * agents persist `connections` instead and this is filled in from it.
	 */
	servers?: MCPServerConfig[];
	/** What the agent persists: registry ids plus per-agent narrowing. */
	connections?: MCPConnectionSelection[];
	/**
	 * Server-prefixed tool names (`acme__search_orders`) the agent may use.
	 * Empty or absent exposes every discovered tool.
	 */
	toolAllowlist?: string[];
}
