# 🔁 Agent Harness LangGraph

> Generic ReAct and ordered-step graphs, adapted to engine-neutral harness events.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-langgraph`

This package is the graph driver. LangGraph stays behind the package boundary;
hosts consume `HarnessEvent` values and never need to parse LangGraph chunks.
No prompts, memory policy, product state, or application services live here.

## ✨ What You Get

| Graph | Default ID | Purpose |
|---|---|---|
| ReAct agent | `agent` | Stream a model, assemble tool calls, execute tools, and loop |
| Linear graph | `linear` | Run an explicit ordered list of registered harness steps |
| Stream adapter | n/a | Convert graph activity into stable harness events |

## 🚀 Agent Loop

```ts
import {
  MODEL_SERVICE,
  createHarness,
  type ModelService,
} from "@memorall/agent-harness-core";
import { langGraphPlugin } from "@memorall/agent-harness-langgraph";
import { createNodePlatform } from "@memorall/agent-harness-node";

const model: ModelService = {
  async *stream() {
    yield {
      type: "completed",
      message: { role: "assistant", content: "Done" },
    };
  },
};

const harness = createHarness({
  platform: createNodePlatform(),
  plugins: [langGraphPlugin({ agent: { maxRetries: 1 } })],
  services: { [MODEL_SERVICE.id]: model },
});

const run = harness.run({
  graph: "agent",
  input: { messages: [{ role: "user", content: "Complete this task" }] },
});

for await (const event of run) console.log(event.type);
```

## 🛠️ Configure The Agent

`AgentGraphOptions` can set a custom graph ID/version, default model, system
prompt, tool allowlist, description, and retry count. Run input may override the
model, system prompt, and tools for one invocation.

Parallel execution is allowed only when tools declare `parallelSafeHint` and
the configured harness limits permit it. Retries require both an idempotent tool
annotation and a retryable error.

## 📏 Linear Pipelines

```ts
langGraphPlugin({
  agent: false,
  linear: {
    id: "prepare-request",
    steps: ["add-system", "current-time"],
  },
});
```

Steps come from explicit plugins such as
[`@memorall/agent-harness-standard`](../standard/README.md). Missing steps or
services fail before partial pipeline execution can silently continue.

## 🌍 Runtime Boundary

The package works in browsers, workers, and Node.js. It depends on LangGraph and
core only; provider SDKs and application policy belong in host adapters.

## 🛠️ Develop The Graph Driver

```bash
yarn workspace @memorall/agent-harness-langgraph dev
yarn workspace @memorall/agent-harness-langgraph test
yarn workspace @memorall/agent-harness-langgraph build
```

Build mode follows project references, so changes in Core are compiled before
the graph driver. The `dev` watcher keeps package exports ready for consumers.
