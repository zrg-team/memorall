# 🌊 Agent Harness Flows

The flow engine in production use: step, tool and graph registries, the built-in
graphs (`agent`, `foundation`), the common steps, and the tool library.

## Registration happens by importing

This package declares `sideEffects: true`, alone among the harness packages.
Importing a module here registers what it defines:

```ts
import "@memorall/agent-harness-flows";            // everything
import "@memorall/agent-harness-flows/steps/index"; // just the steps
```

Never re-export it from a barrel that claims `sideEffects: false` — a bundler is
entitled to drop the registrations, and the failure looks like an agent that
simply has no steps.

## What the host must provide

Nothing here reaches for `window`, `document`, or a Node builtin, so the package
loads under either runtime. What it cannot do alone, it asks for:

| Capability | How it arrives |
|---|---|
| LLM, filesystem, sandbox, web browser, logger, skills | `serviceRegistry`, via the service interfaces in `interfaces/services` |
| HTML parsing (used by the web tools) | `setHtmlParser(html => …)` from `utils/html-parser` |
| Host-owned tools | named with `hostTool("…")`; grep for it to see them all |

A browser host installs the parser in one line:

```ts
import { setHtmlParser } from "@memorall/agent-harness-flows/utils/html-parser";
setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));
```

A Node host passes whichever DOM implementation it already depends on.

## What does not belong here

Product behaviour. Memorall's artifact formats — HyperFrames, Lottie, the OpenUI
response renderer — live in the application, which is why `@hyperframes/core` is
absent from this package's dependencies. If code names a Memorall concept, or
needs a browser or Node API, it belongs in the host.

## Layering

The directories form a DAG, so a finer split into separate packages is now a
mechanical question rather than an architectural one:

```
context, logging          leaves: run lifecycle, runtime vars, logger
  └── interfaces          contracts, including the graph and registry contracts
        └── registries    services, tools, steps, graphs + their schemas
              └── graph   the graph implementations
                    └── steps, tools, runtime, utils
```

Three conventions keep it that way, and breaking any of them puts a cycle back:

- **Contracts live in `interfaces`, implementations above it.** `GraphTool`,
  `BaseStateBase` and friends are declared in `interfaces/engine/graph.ts`;
  `graph/graph.base.ts` re-exports them so existing imports keep working.
- **Registration lives with the registry.** Service schemas are declared in
  `registries/service-schemas.ts`, not beside each service interface.
- **A layer names what it cannot import.** `step.ts` needs the registry set's
  type but must not import it, so the shape is declared globally as
  `FlowRegistrySetContract` and filled in by `registries/registry-set.ts` —
  the same idiom as `ToolTypeRegistry`. Consumers still get concrete types.
