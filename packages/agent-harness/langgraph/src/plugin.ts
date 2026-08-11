import type { HarnessPlugin } from "@memorall/agent-harness-core";
import { createAgentGraph, type AgentGraphOptions } from "./agent-graph.js";
import { createLinearGraph, type LinearGraphOptions } from "./linear-graph.js";

export const LANGGRAPH_PLUGIN_ID = "agent-harness.langgraph";

export interface LangGraphPluginOptions {
  agent?: false | AgentGraphOptions;
  linear?: false | LinearGraphOptions;
}

export const langGraphPlugin = (options: LangGraphPluginOptions = {}): HarnessPlugin => ({
  id: LANGGRAPH_PLUGIN_ID,
  version: "0.1.0",
  register: ({ registerGraph }) => {
    if (options.agent !== false) registerGraph(createAgentGraph(options.agent ?? {}));
    if (options.linear !== false && options.linear) registerGraph(createLinearGraph(options.linear));
  },
});
