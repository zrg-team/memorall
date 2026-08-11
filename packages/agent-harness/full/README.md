# 🚀 Agent Harness Full Facade

> The shortest path from a model adapter to a production-shaped agent runtime.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness`

The full facade re-exports core, LangGraph, standard capabilities, sandbox, and
MCP APIs. It stays side-effect free: importing it registers nothing. Calling
`fullHarnessPreset()` creates plugin descriptors; calling `createFullHarness()`
builds one isolated harness instance.

## ✨ Best For

- applications that want the complete tested package family;
- prototypes that may later split into focused imports;
- hosts that need one clear composition point for browser and Node runtimes.

## 🚀 Create A Harness

```ts
import {
  FILESYSTEM_SERVICE,
  MODEL_SERVICE,
  createFullHarness,
} from "@memorall/agent-harness";
import {
  NodeFileSystem,
  createNodePlatform,
} from "@memorall/agent-harness-node";

const harness = createFullHarness({
  platform: createNodePlatform(),
  preset: {
    standard: {
      web: false,
      skills: false,
      multiAgent: false,
    },
    sandbox: false,
    mcp: false,
  },
  services: {
    [MODEL_SERVICE.id]: modelService,
    [FILESYSTEM_SERVICE.id]: new NodeFileSystem(),
  },
});
```

## 🎛️ Preset Switches

| Option | Default | Controls |
|---|---:|---|
| `langgraph` | enabled | Generic `agent` graph and optional linear graph |
| `standard` | enabled | Chat, files, web, planner, skills, compaction, delegation |
| `sandbox` | enabled | Capability-gated `web_app` sandbox tool profile |
| `mcp` | omitted | MCP tools supplied as discovered descriptors |
| `plugins` | `[]` | Host or domain plugins appended explicitly |

Set a capability to `false` to leave it out completely. Registered capability
does not mean automatic model exposure: graph configuration and provider
capabilities still choose the final tool list.

## 🔍 Inspect Before Running

```ts
const descriptor = harness.inspect();

console.table(descriptor.graphs);
console.table(descriptor.tools);
console.log(descriptor.requiredServices);
```

Inspection makes composition errors visible before a model call. Missing
required services fail with stable harness errors instead of provider-specific
exceptions.

## 🧭 Go Deeper

- Start with [`core`](../core/README.md) to author plugins.
- Read [`standard`](../standard/README.md) to select tools precisely.
- Read [`sandbox`](../sandbox/README.md) before binding a runtime provider.
- Use [`browser`](../browser/README.md) or [`node`](../node/README.md) for host adapters.
