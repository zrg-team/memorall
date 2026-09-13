import type {
	McpCallResult,
	McpToolDescriptor,
} from "@memorall/agent-harness-mcp";
import type { MCPStdioServerConfig } from "../../steps/features/mcp-feature/types.js";

/**
 * Runs MCP servers that are local processes. Provided only by hosts that can
 * start processes; the host owns their lifetime, so there is nothing to close.
 */
export interface IFlowMcpStdioService {
	/**
	 * The server's tools, named `${server.name}__${tool}` exactly as a network
	 * server's are, with `serverId` set to `server.name`.
	 */
	listTools(server: MCPStdioServerConfig): Promise<McpToolDescriptor[]>;
	call(
		server: MCPStdioServerConfig,
		toolName: string,
		input: Readonly<Record<string, unknown>>,
		options?: { signal?: AbortSignal },
	): Promise<McpCallResult>;
}

declare global {
	interface ServiceRegistry {
		mcpStdio?: IFlowMcpStdioService;
	}
}
