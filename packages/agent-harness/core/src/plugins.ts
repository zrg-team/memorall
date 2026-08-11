import { satisfies } from "semver";
import { HarnessError } from "./errors.js";
import type { HarnessGraphDefinition } from "./graph.js";
import type { HarnessRegistries } from "./registries.js";
import type { ServiceToken } from "./services.js";
import type { ToolFactory } from "./tool.js";
import type { HarnessStepDefinition } from "./step.js";

export interface PluginRequirement {
  readonly id: string;
  readonly range: string;
}

export interface HarnessPluginRegistrar {
  readonly registries: HarnessRegistries;
  registerGraph(graph: HarnessGraphDefinition): void;
  registerStep(step: HarnessStepDefinition): void;
  registerTool(name: string, factory: ToolFactory): void;
  requireService(token: ServiceToken<unknown>): void;
}

export interface HarnessPlugin<TContribution = unknown> {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly PluginRequirement[];
  register(registrar: HarnessPluginRegistrar): TContribution | void;
}

export interface InstalledPlugins {
  readonly versions: Readonly<Record<string, string>>;
  readonly requiredServices: readonly ServiceToken<unknown>[];
}

const visitPlugin = (
  plugin: HarnessPlugin,
  plugins: ReadonlyMap<string, HarnessPlugin>,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: HarnessPlugin[],
): void => {
  if (visited.has(plugin.id)) return;
  if (visiting.has(plugin.id)) {
    throw new HarnessError("plugin_cycle", `Plugin dependency cycle includes ${plugin.id}`);
  }
  visiting.add(plugin.id);
  for (const requirement of plugin.requires ?? []) {
    const dependency = plugins.get(requirement.id);
    if (!dependency) {
      throw new HarnessError("missing_plugin", `Missing plugin ${requirement.id} required by ${plugin.id}`);
    }
    if (!satisfies(dependency.version, requirement.range)) {
      throw new HarnessError(
        "plugin_version_mismatch",
        `Plugin ${plugin.id} requires ${requirement.id}@${requirement.range}, got ${dependency.version}`,
      );
    }
    visitPlugin(dependency, plugins, visiting, visited, ordered);
  }
  visiting.delete(plugin.id);
  visited.add(plugin.id);
  ordered.push(plugin);
};

export const installPlugins = (
  input: readonly HarnessPlugin[],
  registries: HarnessRegistries,
): InstalledPlugins => {
  const plugins = new Map<string, HarnessPlugin>();
  for (const plugin of input) {
    if (plugins.has(plugin.id)) {
      throw new HarnessError("duplicate_registration", `Duplicate plugin ID: ${plugin.id}`);
    }
    plugins.set(plugin.id, plugin);
  }

  const ordered: HarnessPlugin[] = [];
  const visited = new Set<string>();
  for (const plugin of plugins.values()) {
    visitPlugin(plugin, plugins, new Set(), visited, ordered);
  }

  const requiredServices = new Map<string, ServiceToken<unknown>>();
  const registrar: HarnessPluginRegistrar = {
    registries,
    registerGraph: (graph) => registries.graphs.register(graph),
    registerStep: (step) => registries.steps.register(step),
    registerTool: (name, factory) => registries.tools.register(name, factory),
    requireService: (token) => requiredServices.set(token.id, token),
  };
  for (const plugin of ordered) plugin.register(registrar);

  return {
    versions: Object.freeze(Object.fromEntries(ordered.map(({ id, version }) => [id, version]))),
    requiredServices: Object.freeze([...requiredServices.values()]),
  };
};
