# Memorall Flow Runtime

This directory is the application's live flow engine: the graphs, steps, tools,
features, prompts, and streaming behavior that every chat turn actually runs. It
is app-owned, and it is reached through the harness plugin in
[`src/services/agent-harness`](../agent-harness), which translates its graph
streams into engine-neutral harness events.

It was previously named `flows-legacy`. That name described an intent — migrate
onto [`packages/agent-harness`](../../../packages/agent-harness) — rather than a
fact, and the intent is nowhere near complete: essentially every file here is
reachable from the extension, web, and desktop entry points. Code that ships on
the hot path of the product should not be labelled as though it were retired, so
it is named for what it is. When the migration does land, this directory gets
deleted rather than renamed again.

Do not add reusable harness infrastructure here. Reusable contracts, execution,
standard capabilities, sandbox orchestration, MCP support, and platform adapters
belong under [`packages/agent-harness`](../../../packages/agent-harness).

The dependency direction is one-way. This runtime may depend on Memorall memory,
document, catalog, UI, and extension behavior; the standalone harness packages
must never depend on this directory. Stored public flow IDs remain covered by the
compatibility contract tests.
