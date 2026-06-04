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

export interface MCPFeatureConfig {
	servers?: MCPServerConfig[];
}
