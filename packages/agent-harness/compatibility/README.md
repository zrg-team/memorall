# 🧭 Agent Harness Compatibility

> Preserve old public IDs while moving execution to explicit harness plugins.

[← Workspace guide](../README.md) · **Package:** `@memorall/agent-harness-compat`

Compatibility is an opt-in bridge for stored flows and external integrations.
It declares known legacy graph, step, and container-tool IDs, then registers
implementations supplied by the host. It contains no application prompts,
persistence rules, browser services, or hidden fallback behavior.

## ✨ What It Preserves

- legacy graph IDs such as `foundation` and `agent`;
- established step IDs used by stored flow definitions;
- deprecated `container_*` tool IDs during a migration window;
- the host's existing implementations and semantics.

## 🚀 Register A Bridge

```ts
import { createHarness } from "@memorall/agent-harness-core";
import { compatibilityPlugin } from "@memorall/agent-harness-compat";

const compatibility = compatibilityPlugin({
  graphs: [legacyFoundationGraph],
  steps: [legacySystemStep],
  tools: {
    container_run_code: () => legacyContainerRunTool,
  },
});

const harness = createHarness({
  platform,
  plugins: [compatibility],
  services,
});
```

Nothing happens at import time. If the compatibility plugin is omitted, legacy
IDs are unavailable by design.

## 🛡️ Migration Rules

1. Keep new graphs and tools on current IDs.
2. Enable compatibility only for hosts that load stored legacy definitions.
3. Keep deprecated `container_*` tools out of new model profiles.
4. Measure legacy usage before removing an ID.
5. Remove bridges in a versioned migration, never through silent replacement.

## 🚫 What This Package Is Not

It is not a global registry, automatic data migration, provider adapter, or
application compatibility layer. The host remains responsible for supplying and
eventually retiring each legacy implementation.
