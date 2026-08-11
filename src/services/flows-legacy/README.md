# Memorall Legacy Flow Runtime

This directory is application-owned compatibility code. It preserves Memorall's
stored graph, step, tool, feature, prompt, and stream behavior while the product
uses the standalone harness through `src/services/agent-harness`.

Do not add reusable harness infrastructure here. Reusable contracts, execution,
standard capabilities, sandbox orchestration, MCP support, and platform adapters
belong under [`packages/agent-harness`](../../../packages/agent-harness).

The compatibility runtime may depend on Memorall memory, document, catalog, UI,
and extension behavior. Standalone harness packages must never depend on this
directory.

New application execution enters through the app-owned compatibility plugin in
[`src/services/agent-harness`](../agent-harness), which translates legacy graph
streams into engine-neutral harness events. Stored public IDs remain covered by
the compatibility contract tests.
