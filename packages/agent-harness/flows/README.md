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

## Known gaps

- `noUncheckedIndexedAccess` is off here and on everywhere else. Turning it on
  surfaces 72 real "possibly undefined" sites inherited from the application.
- The internal layers are not yet a DAG (`graph ↔ runtime`, `interfaces ↔
  registries`, `steps ↔ tools`, and three more), which is what keeps this a
  single package rather than several.
