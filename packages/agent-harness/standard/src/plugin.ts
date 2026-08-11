import type { HarnessPlugin } from "@memorall/agent-harness-core";
import { chatPlugin, type AddSystemStepOptions } from "./chat/index.js";
import { compactionPlugin } from "./compaction/index.js";
import { filesystemPlugin } from "./filesystem/index.js";
import { multiAgentPlugin } from "./multi-agent/index.js";
import { plannerPlugin } from "./planner/index.js";
import { skillsPlugin } from "./skills/index.js";
import { webPlugin } from "./web/index.js";

export const STANDARD_PLUGIN_ID = "agent-harness.standard";

export interface StandardPluginOptions {
  chat?: false | AddSystemStepOptions;
  filesystem?: boolean;
  web?: boolean;
  planner?: boolean;
  skills?: boolean;
  compaction?: false | { maxTokens?: number };
  multiAgent?: boolean;
}

export const standardToolsPlugin = (options: StandardPluginOptions = {}): HarnessPlugin => {
  const plugins = [
    ...(options.chat === false ? [] : [chatPlugin(options.chat ?? {})]),
    ...(options.filesystem === false ? [] : [filesystemPlugin()]),
    ...(options.web === false ? [] : [webPlugin()]),
    ...(options.planner === false ? [] : [plannerPlugin()]),
    ...(options.skills === false ? [] : [skillsPlugin()]),
    ...(options.compaction === false ? [] : [compactionPlugin(options.compaction ?? {})]),
    ...(options.multiAgent === false ? [] : [multiAgentPlugin()]),
  ];
  return {
    id: STANDARD_PLUGIN_ID,
    version: "0.1.0",
    register: (registrar) => {
      for (const plugin of plugins) plugin.register(registrar);
    },
  };
};

export const standardPlugins = (options: StandardPluginOptions = {}): readonly HarnessPlugin[] => [
  standardToolsPlugin(options),
];
