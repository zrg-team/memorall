# What Is `flows`? — And What It Should Be Called

## The Problem With "flows"

`src/services/flows` is called "flows" because it was built around LangGraph's concept of a graph flow — a directed execution graph with nodes and edges. That name describes the **implementation detail** (how it runs), not the **purpose** (what it is).

The name leaks an internal mechanism to every developer who reads it. It answers the wrong question: *"How is this built?"* instead of *"What does this do?"*

---

## What the Module Actually Is

Based on the established definition from harness engineering research (2026):

> **Harness** — the operational logic that wraps around the model itself, including the conversation loop, tool routing, error handling, context management, and the runtime decisions.

The equation from the field:

```
Agent = Model + Harness
```

`src/services/flows` is the harness. The model (`IFlowLLMService`) is the only thing that is not the harness. Everything else — the execution loop, tool dispatch, memory retrieval, context injection, lifecycle hooks, step middleware, registries — is the harness.

The module does not describe a "flow". It wraps an LLM and makes it capable of doing work.

---

## Naming Options

Four terms emerge from the research as candidates. They are not interchangeable — each has a precise meaning.

| Term | Research Definition | Fits This Module? |
|---|---|---|
| **Scaffold** | Pre-generated code/templates used once at project init. Setup-time, not runtime. | No — this module runs on every request |
| **Framework** | Imposes architecture on callers, prescribes lifecycle and design patterns | No — callers inject services; the module does not impose structure on callers |
| **SDK** | Building blocks and APIs for developers to build applications on top of | Partially — but we don't expose raw building blocks; we run the agent |
| **Harness** | Operational runtime logic wrapping the model: loop, tools, memory, context, error handling | Yes — exactly this |

---

## Recommended Name: `harness`

**`src/services/harness`**

### Why

1. **Matches the established industry definition precisely.** The research defines harness as the operational runtime around the model. That is exactly what this module is.

2. **Follows the user's principle: standard-first, no creativity.** "Harness" is the term the field uses. Using it means any developer familiar with agentic AI architecture immediately understands the module's role.

3. **Answers the right question.** `flows` → "how is it implemented?". `harness` → "what role does it play?".

4. **Scales with the architecture.** As the module gains more capabilities (multi-agent coordination, evals, guardrails), "harness" remains accurate. "flows" becomes increasingly misleading.

5. **Distinguishes from LangGraph.** LangGraph provides the graph execution primitive. The harness uses LangGraph internally but is not reducible to it — just as a car is not reducible to its engine.

---

## Alternative Names (If `harness` Is Too Abstract)

| Name | Meaning | Tradeoff |
|---|---|---|
| `agent-runtime` | The runtime that executes agents | Clear and technical; "runtime" implies execution infrastructure |
| `engine` | The engine that powers agent execution | Short; "agent engine" is common in the field; less precise than harness |
| `harness` | **(Recommended)** The complete operational wrapper around the model | Exact term from the research |

`agent-runtime` is the strongest alternative if `harness` feels too unfamiliar to the team. It describes what the module does at runtime without being tied to the implementation.

---

## What the Harness Contains

The harness is everything except the model. Mapped to the current codebase:

```
harness/
├── interfaces/          Contract layer — what the harness expects from outside
│   ├── messages.ts      OpenAI message wire format (the shared language)
│   ├── llm.ts           IFlowLLMService — the model socket
│   ├── database.ts      IFlowDatabase — storage
│   ├── filesystem.ts    IFlowFileSystem — file access
│   ├── embedding.ts     IFlowEmbeddingService — vector operations
│   ├── logger.ts        IFlowLogger — observability
│   ├── web-browser.ts   IFlowWebBrowserService — web capability
│   ├── sandbox.ts       IFlowSandboxService — code execution
│   └── tool.ts          AllServices — the full injection contract
│
├── graph/               Execution loop layer — LangGraph topology
│   ├── graph.base.ts    Loop engine: compile, invoke, stream, tool dispatch
│   ├── foundation/      Linear step chain (config-driven)
│   ├── agent/           ReAct loop: agent ⇄ tool_executor
│   ├── knowledge/       Knowledge extraction pipeline
│   └── structmem/       Structured memory consolidation
│
├── steps/               Middleware layer — nodes that run before/after model call
│   ├── common/          System prompt, context injection, compaction
│   ├── features/        Pluggable feature steps (web, fs, memory, planner, …)
│   ├── knowledge-retrieval/  RAG retrieval strategies
│   └── structmem/       Structured memory retrieval and save
│
├── tools/               Capability layer — what the model can do
│   ├── web/             Web browsing and search
│   ├── fs/ + documents/ File and document operations
│   ├── sandbox/         Code execution
│   ├── planner/         Task planning
│   ├── active-memory/   Working memory read/write
│   ├── co-agent/        Multi-agent coordination
│   └── knowledge-graph  Knowledge graph read/write
│
├── runtime/             Lifecycle and per-run state
│   ├── run-lifecycle.ts onFinish / onBeforeStart / onAfterEnd hooks
│   └── runtime-context.ts FlowRuntimeVars — transient per-run key-value store
│
├── utils/               Internal utilities (vector search, graph query, ID mapping)
│
├── *-registry.ts        Plugin layer — step, tool, flow, feature registries
│
└── index.ts             Public entry point → registerBuiltins()
```

---

## How the Harness Works at Runtime

```
User message arrives
        ↓
[ENTRY]
chatFlowRegistry.create(graphType, services, config)
Selects the right graph topology and initializes it with injected services.
        ↓
[GRAPH / LOOP]
graph.stream(initialState)
Runs the compiled LangGraph StateGraph.
        ↓
[STEP MIDDLEWARE]  — runs in sequence as LangGraph nodes
  1. add-system          → injects system prompt
  2. context-retrieve    → RAG: injects relevant knowledge into messages
  3. structmem-retrieve  → loads structured memory events
  4. [feature steps]     → each feature adds its tools to state.tools
        ↓
[MODEL CALL — ReAct loop inside agent-completion step]
  agent node:
    calls services.llm.chat.completions.create({ messages, tools, stream: true })
    accumulates response and tool_calls from stream

    if tool_calls:
      tool_executor node:
        resolves each tool by name from executorMap
        validates input against schema
        calls tool.execute(args, { state, runtime })
        injects result as { role: "tool" } message
      loops back to agent node

    if no tool_calls:
      commits messages + final response to state
        ↓
[STREAM OUTPUT]
Chunks flow to caller: { type: "llm", chunk } and { type: "execute-start", tool }
        ↓
[LIFECYCLE DRAIN]  — after stream fully consumed
runLifecycle.drain()
  Fires all registered onFinish callbacks:
    save extracted entities to knowledge graph
    save structured memory events
    write citations
```

---

## The Harness Is Not the Framework

LangGraph is the framework. It imposes the graph topology, the node model, the state annotation pattern, and the streaming protocol.

The harness *uses* LangGraph. It does not expose LangGraph to callers. From the outside, the harness is a black box that takes `AllServices + UnifiedFlowConfig` and returns a streamable agent. LangGraph is an internal implementation detail — the same way the model itself is.

```
Caller
  └─ sees: AllServices, registerBuiltins(), chatFlowRegistry.create()
           ↑ harness public surface

Harness
  └─ uses internally: LangGraph, step-registry, tool-registry, graph classes
                      ↑ not visible to caller

Model (IFlowLLMService)
  └─ injected by caller, used by harness
```

---

## Summary

| | Current (`flows`) | Recommended (`harness`) |
|---|---|---|
| Name describes | Implementation detail (LangGraph flows) | Purpose (wraps the model, makes it capable) |
| Industry alignment | None — "flows" is not a standard term in this context | Direct — "Agent = Model + Harness" is the established equation |
| Scales with features | Misleading as capabilities expand beyond "flows" | Accurate at any scale |
| Developer onboarding | Requires explanation | Self-documenting to anyone familiar with agentic AI |
