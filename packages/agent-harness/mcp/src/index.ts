import type { HarnessPlugin } from "@memorall/agent-harness-core";
import type { McpToolDescriptor } from "./contracts.js";
import { adaptMcpTool } from "./tool-adapter.js";

export * from "./client.js";
export * from "./contracts.js";
export * from "./http-transport.js";
export * from "./tool-adapter.js";

export const MCP_PLUGIN_ID = "agent-harness.mcp";

export const mcpPlugin = (tools: readonly McpToolDescriptor[]): HarnessPlugin => ({
  id: MCP_PLUGIN_ID,
  version: "0.1.0",
  register(registrar) {
    for (const descriptor of tools) {
      registrar.registerTool(descriptor.exposedName, () => adaptMcpTool(descriptor));
    }
  },
});
