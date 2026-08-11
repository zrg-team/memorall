import {
  createHarness,
  type AgentHarness,
  type CreateHarnessOptions,
  type HarnessPlugin,
} from "@memorall/agent-harness-core";
import { langGraphPlugin, type LangGraphPluginOptions } from "@memorall/agent-harness-langgraph";
import { mcpPlugin, type McpToolDescriptor } from "@memorall/agent-harness-mcp";
import { sandboxPlugin, type SandboxPluginOptions } from "@memorall/agent-harness-sandbox";
import { standardToolsPlugin, type StandardPluginOptions } from "@memorall/agent-harness-standard";

export * from "@memorall/agent-harness-core";
export * from "@memorall/agent-harness-langgraph";
export * from "@memorall/agent-harness-mcp";
export * from "@memorall/agent-harness-sandbox";
export * from "@memorall/agent-harness-standard";

export interface FullHarnessPresetOptions {
  readonly langgraph?: false | LangGraphPluginOptions;
  readonly standard?: false | StandardPluginOptions;
  readonly sandbox?: false | SandboxPluginOptions;
  readonly mcp?: false | readonly McpToolDescriptor[];
  readonly plugins?: readonly HarnessPlugin[];
}

/** Side-effect-free preset: calling it only creates plugin descriptors. */
export const fullHarnessPreset = (options: FullHarnessPresetOptions = {}): readonly HarnessPlugin[] => [
  ...(options.langgraph === false ? [] : [langGraphPlugin(options.langgraph ?? {})]),
  ...(options.standard === false ? [] : [standardToolsPlugin(options.standard ?? {})]),
  ...(options.sandbox === false ? [] : [sandboxPlugin(options.sandbox ?? {})]),
  ...(options.mcp === false || options.mcp === undefined ? [] : [mcpPlugin(options.mcp)]),
  ...(options.plugins ?? []),
];

export interface CreateFullHarnessOptions extends Omit<CreateHarnessOptions, "plugins"> {
  readonly preset?: FullHarnessPresetOptions;
}

export const createFullHarness = (options: CreateFullHarnessOptions): AgentHarness => createHarness({
  ...options,
  plugins: fullHarnessPreset(options.preset),
});
