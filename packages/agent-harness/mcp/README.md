# 🔌 Agent Harness MCP

> Discover MCP tools, preserve their structured results, and install them as
> explicit harness plugins.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-mcp`

This package provides browser-compatible Streamable HTTP and SSE transports,
connection lifecycle, paginated tool discovery, JSON Schema validation, stable
tool naming, and MCP-to-harness result adaptation.

## 🚀 Discover And Register Tools

```ts
import {
  MCP_TOOL_SERVICE,
  McpClientManager,
  mcpPlugin,
} from "@memorall/agent-harness-mcp";

const mcp = new McpClientManager(
  [{ id: "docs", url: "https://example.com/mcp", transport: "http" }],
  { prefixToolNames: true },
);

const descriptors = await mcp.discover();
const plugins = [mcpPlugin(descriptors)];
const services = { [MCP_TOOL_SERVICE.id]: mcp };

// Pass plugins and services to createHarness(), then close when the host exits.
await mcp.close();
```

With prefixes enabled, a server tool such as `search` becomes `docs__search`,
which prevents collisions when several servers expose common names.

## ✨ Preserved MCP Data

| MCP field | Harness destination |
|---|---|
| text/content blocks | model-facing tool content |
| `structuredContent` | `ToolExecutionResult.structuredContent` |
| `_meta` | structured result metadata |
| input/output schemas | tool validation and public schema |
| annotations | read-only, destructive, idempotent, open-world hints |
| icons | tool display metadata |

Agents and UI code do not need to parse terminal prose to recover MCP results.

## 🌐 Transport Choices

- Use Streamable HTTP by default.
- Select `transport: "sse"` for compatible legacy servers.
- Inject `fetch` when credentials, testing, or a custom network stack requires it.
- Configure bounded reconnect attempts through `reconnect` options.
- Use [`McpStdioClientManager`](../node/README.md) from the Node package for stdio.

## 🛡️ Lifecycle Boundary

Discovery is asynchronous, so build descriptors before constructing the
immutable harness. The host owns authentication, server configuration, connect,
reconnect, and close behavior. Importing this package opens no connections and
registers no tools.

## 🛠️ Develop MCP Support

```bash
yarn workspace @memorall/agent-harness-mcp dev
yarn workspace @memorall/agent-harness-mcp test
yarn workspace @memorall/agent-harness-mcp build
```

The package watcher follows Core project references and continuously refreshes
the ESM and declaration outputs consumed by browser and Node adapters.
