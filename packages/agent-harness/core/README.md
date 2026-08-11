# ⚙️ Agent Harness Core

> The small, environment-neutral kernel behind every Agent Harness application.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-core`

Core owns contracts and orchestration, not product behavior. It creates isolated
harness instances, installs explicit plugins, freezes registries, starts runs,
streams events, validates tools, propagates cancellation, and coordinates
checkpoints and cleanup.

## ✨ Use Core When

- you are building a custom graph driver or capability plugin;
- you need the smallest browser/worker bundle;
- you want complete control over graphs, tools, limits, and services;
- you are implementing a remote transport against stable JSON-safe contracts.

## 🚀 Minimal Run

```ts
import {
  createHarness,
  type HarnessPlugin,
} from "@memorall/agent-harness-core";
import { createNodePlatform } from "@memorall/agent-harness-node";

const echoPlugin: HarnessPlugin = {
  id: "example.echo",
  version: "1.0.0",
  register({ registerGraph }) {
    registerGraph({
      id: "echo",
      version: "1.0.0",
      async execute({ input }) {
        return { output: String(input) };
      },
    });
  },
};

const harness = createHarness({
  platform: createNodePlatform(),
  plugins: [echoPlugin],
});

const result = await harness.run({ graph: "echo", input: "Hello" }).result();
console.log(result.output); // Hello
await harness.close();
```

## 🧱 Public Building Blocks

| Area | Key exports |
|---|---|
| Runs | `createHarness`, `AgentHarness`, `HarnessRun`, `HarnessRunRequest` |
| Plugins | `HarnessPlugin`, `HarnessPluginRegistrar`, `installPlugins` |
| Graphs and steps | `HarnessGraphDefinition`, `HarnessStepDefinition` |
| Tools | `BaseTool`, `ToolExecutionResult`, `jsonToolSchema`, `executeTool` |
| Services | `createServiceToken`, `ServiceResolver`, `MODEL_SERVICE` |
| Runtime | `RunContext`, `RunLifecycle`, `HarnessPlatform`, `HarnessLimits` |
| Persistence | `HarnessCheckpointStore`, `HarnessEventStore` |
| Observability | `HarnessEvent`, `HarnessEventSink`, serialized harness errors |

## 🧩 Plugin Rules

Plugins register runtime string IDs without ambient type augmentation. Install
validates duplicate IDs, missing dependencies, semver requirements, and cycles
before the first run. Registries freeze after construction, so concurrent
harness instances cannot observe each other's tools or state.

## 🧪 Testing

The `@memorall/agent-harness-core/testing` subpath exports deterministic test
primitives:

```ts
import {
  MemoryCheckpointStore,
  MemoryEventStore,
  createTestPlatform,
} from "@memorall/agent-harness-core/testing";
```

## 🌍 Runtime Boundary

Core uses ES modules and portable Web Platform primitives. It does not import
LangGraph, React, DOM APIs, Chrome APIs, Node built-ins, provider SDKs, or
application code. Choose [`browser`](../browser/README.md) or
[`node`](../node/README.md) for concrete platform adapters.

## 🛠️ Develop Core

```bash
yarn workspace @memorall/agent-harness-core dev
yarn workspace @memorall/agent-harness-core test
yarn workspace @memorall/agent-harness-core build
```

`dev` keeps `dist/` current with TypeScript build-mode watch. Use `clean` before
a from-scratch package build when validating project-reference output.
