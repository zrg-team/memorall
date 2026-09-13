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

/**
 * A server started as a local process. Only hosts that can start processes (the
 * desktop app) provide the `mcpStdio` service that runs it; elsewhere the step
 * skips it.
 */
export interface MCPStdioServerConfig {
	type: "stdio";
	/** Tool prefix, like a network server's name; may differ between agents. */
	name: string;
	/** The connection id, which identifies the process across agents. */
	id: string;
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
	/** Keys of `env` whose values are secrets. */
	secretEnvKeys?: string[];
}

export type MCPNetworkServerConfig = MCPHTTPServerConfig | MCPSSEServerConfig;

export type MCPServerConfig = MCPNetworkServerConfig | MCPStdioServerConfig;

export const isStdioServer = (
	server: MCPServerConfig,
): server is MCPStdioServerConfig => server.type === "stdio";

export const isNetworkServer = (
	server: MCPServerConfig,
): server is MCPNetworkServerConfig => server.type !== "stdio";

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
