import type {
  HarnessGraphDefinition,
  HarnessPlugin,
  HarnessStepDefinition,
  ToolFactory,
} from "@memorall/agent-harness-core";

export const COMPATIBILITY_PLUGIN_ID = "agent-harness.compatibility";

export const LEGACY_GRAPH_IDS = ["foundation", "agent"] as const;
export const LEGACY_STEP_IDS = [
  "add-skill-context", "add-system", "agent-completion", "agent-node", "artifact-feature",
  "auto-compact", "chat-completion", "context-to-system", "current-time", "fs-feature",
  "gpt-boost", "hyperframes-feature", "lottie-animation-feature", "mcp-feature",
  "multi-agent-feature", "nodejs-sandbox-feature", "planner-feature", "visualize-response", "web-feature",
] as const;
export const LEGACY_CONTAINER_TOOL_IDS = [
  "container_clear_logs", "container_execute_command", "container_fetch_resource", "container_exists",
  "container_get_logs", "container_install_package", "container_list_commands", "container_listen_command",
  "container_list_servers", "container_request_server", "container_render_server", "container_restart_server",
  "container_run_code", "container_send_command_input", "container_start_server", "container_stop_command",
  "container_stop_server",
] as const;

export interface LegacyCompatibilityOptions {
  readonly graphs?: readonly HarnessGraphDefinition[];
  readonly steps?: readonly HarnessStepDefinition[];
  readonly tools?: Readonly<Record<string, ToolFactory>>;
}

/**
 * Registers legacy implementations supplied by the host. The bridge deliberately
 * contains no product prompts, persistence rules, or browser-extension services.
 */
export const compatibilityPlugin = (options: LegacyCompatibilityOptions): HarnessPlugin => ({
  id: COMPATIBILITY_PLUGIN_ID,
  version: "0.1.0",
  register(registrar) {
    for (const graph of options.graphs ?? []) registrar.registerGraph(graph);
    for (const step of options.steps ?? []) registrar.registerStep(step);
    for (const [name, factory] of Object.entries(options.tools ?? {})) registrar.registerTool(name, factory);
  },
});
