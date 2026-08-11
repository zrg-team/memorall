import type { HarnessPlugin } from "@memorall/agent-harness-core";
import { getSandboxToolsForProfile, type SandboxToolProfile } from "./profiles.js";
import { createSandboxTools } from "./tools/index.js";

export * from "./contracts.js";
export * from "./profiles.js";
export * from "./provider-registry.js";
export * from "./sandbox-manager.js";
export * from "./tools/index.js";
export * from "./workspace-coordinator.js";

export const SANDBOX_PLUGIN_ID = "agent-harness.sandbox";

export interface SandboxPluginOptions {
  readonly profile?: SandboxToolProfile;
  readonly supportedCapabilities?: readonly string[];
}

/** Registers model-facing tools only; provider and session lifecycle stay host-owned. */
export const sandboxPlugin = (options: SandboxPluginOptions = {}): HarnessPlugin => ({
  id: SANDBOX_PLUGIN_ID,
  version: "0.1.0",
  register(registrar) {
    const tools = createSandboxTools();
    for (const name of getSandboxToolsForProfile(
      options.profile ?? "web_app",
      options.supportedCapabilities,
    )) {
      registrar.registerTool(name, () => tools[name]!);
    }
  },
});
