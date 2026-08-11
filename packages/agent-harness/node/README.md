# 🟢 Agent Harness Node

> Production-ready Node.js adapters for portable harness contracts.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-node`

Use this package at a Node host boundary. Universal graphs and tools stay in
their focused packages; Node-specific filesystem, process, stdio, and Playwright
implementations live here.

## ✨ Included Adapters

| Export | Purpose |
|---|---|
| `createNodePlatform()` | Node clock, UUID, scheduling, and fetch primitives |
| `NodeFileSystem` | `node:fs/promises` implementation of `HarnessFileSystem` |
| `FileCheckpointStore` | atomic JSON checkpoint persistence |
| `FileEventStore` | serialized per-run event persistence |
| `NodeLocalSandboxProvider` | capability-gated local process sandbox provider |
| `McpStdioClientManager` | MCP client lifecycle over child-process stdio |
| `PlaywrightWebBrowserService` | optional browser automation via `./playwright` |

## 🚀 Compose A Node Host

```ts
import { FILESYSTEM_SERVICE } from "@memorall/agent-harness-standard";
import {
  FileCheckpointStore,
  FileEventStore,
  NodeFileSystem,
  createNodePlatform,
} from "@memorall/agent-harness-node";

const harnessOptions = {
  platform: createNodePlatform(),
  checkpointStore: new FileCheckpointStore(".agent-state"),
  eventStore: new FileEventStore(".agent-state"),
  services: {
    [FILESYSTEM_SERVICE.id]: new NodeFileSystem(),
  },
};
```

## 🧪 Local Sandbox

```ts
import { NodeLocalSandboxProvider } from "@memorall/agent-harness-node";

const provider = new NodeLocalSandboxProvider({
  id: "node-local",
  maxOutputChars: 200_000,
});
```

Register the provider through
[`SandboxProviderRegistry`](../sandbox/README.md). Models still use the same
grouped `sandbox_*` tools as browser or remote providers.

## 🔌 MCP Stdio

`McpStdioClientManager` is intentionally Node-only. HTTP and SSE remain in the
universal [`MCP package`](../mcp/README.md), so browser bundles never inherit
`child_process`.

## 🎭 Optional Playwright

Import Playwright support explicitly:

```ts
import { PlaywrightWebBrowserService } from "@memorall/agent-harness-node/playwright";
```

The main entry point does not force Playwright into consumers that only need
filesystem or persistence adapters.

## 📏 Requirements

- Node.js 22 or newer
- ESM
- host-managed filesystem permissions and process lifecycle
- explicit service/plugin composition through core

## 🛠️ Develop Node Adapters

```bash
yarn workspace @memorall/agent-harness-node dev
yarn workspace @memorall/agent-harness-node test
yarn workspace @memorall/agent-harness-node build
```

Build mode compiles Core, Standard, Sandbox, and MCP references in dependency
order before emitting Node adapter output.
