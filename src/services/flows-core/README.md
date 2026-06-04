# ⚡ flows-core — Agent Harness Engine

> The infrastructure that turns a stateless LLM into a system that **plans**, **acts**, **remembers**, and **recovers** — across any topology, any environment, any scale.

---

## Why flows-core is the Agent Harness

An LLM alone predicts tokens. It has no memory, no tools, no control flow, no awareness of the real world. `flows-core` wraps every one of those missing corners with a dedicated layer. Together, those layers form the **agent harness** — the infrastructure between the model and reality.

```
╔═══════════════════════════════════════════════════════════════╗
║                      flows-core harness                       ║
║                                                               ║
║  🕸️  graph      ──  any execution topology you define         ║
║  🔗  steps      ──  any context, feature, or transform        ║
║  🪝  lifecycle  ──  any side-effect around any node           ║
║  🔧  tools      ──  any action the LLM can invoke             ║
║  🌐  services   ──  any real-world system, swappable          ║
║                                                               ║
║                        ┌─────────┐                            ║
║                        │   LLM   │                            ║
║                        └─────────┘                            ║
╚═══════════════════════════════════════════════════════════════╝
```

Every layer is a **registry**. You register into it from anywhere. The engine discovers and wires everything at runtime. No layer knows about any other layer — only the registries connect them.

---

## 🕸️ Graph — any execution topology

**What corner it covers:** when the LLM fires, where its output goes, whether it loops, how many agents run.

Extend `GraphBase`. Define any `StateGraph` topology — nodes, conditional edges, loops, sub-graphs, multi-agent DAGs. `GraphBase` provides lifecycle wrapping, streaming, and service injection. The shape of the flow is entirely yours.

```ts
class PlannerFlow extends GraphBase<"plan" | "execute" | "reflect", PlannerState, Services> {
  constructor(services: Services) {
    super(services);
    this.workflow = new StateGraph(PlannerAnnotation);

    this.addNode("plan",    this.planNode);      // ← lifecycle hooks injected automatically
    this.addNode("execute", this.executeNode);
    this.addNode("reflect", this.reflectNode);

    this.workflow.addEdge(START, "plan");
    this.workflow.addEdge("plan", "execute");
    this.workflow.addConditionalEdges("execute", (state) => {
      if (state.failed)   return "plan";         // ← replan on failure
      if (state.needsQA)  return "reflect";      // ← QA pass before done
      return END;
    });
    this.workflow.addEdge("reflect", END);
    this.compile();
  }
}

graphRegistry.register("planner", {
  id:      "planner",
  factory: (services, config, ctx) => new PlannerFlow(services),
  config: {
    stepOrder: ["add-system", "__features__", "agent-completion"],
    chat: (services, config) => ({
      graph: new PlannerFlow(services),
      getInitialState: (ctx) => ({ messages: ctx.messages, tools: [] }),
    }),
  },
});
```

A planner-executor-critic loop, a knowledge extraction DAG, a multi-agent coordinator, a document pipeline, a RAG flow — **any `StateGraph` topology, registered once, discovered by the engine**.

> **Scales by:** one new class + one `graphRegistry.register`. Nothing else changes.

---

## 🔗 Steps — construct what the LLM needs to solve a problem

**What corner it covers:** every piece of information the LLM receives — tools, system prompts, messages, context, runtime vars — assembled independently per business domain.

A step is an independent unit that constructs the LLM's input for a specific problem. Each step owns its slice: it reads graph state, builds what it needs — tools to enable, instructions to inject, messages to prepend, runtime vars to set — and writes back. Steps don't know about each other. The LLM receives everything assembled.

```
step A  →  adds domain system prompt to messages
step B  →  pushes relevant tools into state.tools
step C  →  injects retrieved context into messages
step D  →  sets runtime vars the graph will use downstream
               ↓
           LLM sees the full assembled picture
```

Any business capability is a step: a coding sandbox, a job application assistant, a daily briefing agent, a UI renderer, a travel planner. Each one constructs exactly the tools, prompts, and context that domain needs — nothing more. Register it, and any graph that has the `__features__` slot picks it up:

```ts
stepRegistry.register("my-feature", factory, {
  injectAfter: "__features__",
  feature: { type: "feature", graphTypes: ["foundation", "agent"] },
});
```

> **Scales by:** one `stepRegistry.register` call. A new business domain is a new step — no graph changes, no changes to any other step.

---

## 🪝 Lifecycle Hooks — any side-effect around any node

**What corner it covers:** everything that needs to happen at the boundaries of node execution — injecting context, patching results, recovering from errors, persisting state after the stream ends.

Every node added via `GraphBase.addNode` is wrapped by `toNode()`. A step registers callbacks during its own execution — the harness fires them at the right moment without the node knowing:

```ts
// inside any step's execute():
const lifecycle = getFlowRunLifecycle(runConfig);

// inject extra context right before the model fires
lifecycle?.onBeforeStart("enrich", "agent-completion", async (state) => {
  const extra = await services.db.retrieve(state.messages);
  return { messages: [...state.messages, extra] };       // ← patches local state
});

// recover from errors without polluting the node
lifecycle?.onCatch("guard", async (nodeName, error, state) => {
  logError(nodeName, error);
  return { response: "Something went wrong, please try again." };  // ← recovery
});

// save knowledge after the entire stream is consumed
lifecycle?.onFinish("persist", async () => {
  await services.database.saveKnowledge(extractedFacts);  // ← runs after last chunk
});
```

| 🪝 Hook | ⏱️ Fires | 💡 Can do |
|---|---|---|
| `onBeforeStart` | Before node fn | Patch local state going in |
| `onCatch` | On any node error | Return recovery, suppress rethrow |
| `onAfterEnd` | After node fn returns | Patch node result |
| `onFinish` | After stream fully consumed | Save, persist, cleanup |

> **Scales by:** any step attaches any callback to any node. The node is untouched. Post-run work grows without changing graph topology.

---

## 🔧 Tools — any action the LLM can invoke

**What corner it covers:** everything the LLM is allowed to call — validated with Zod, executed against real services, streamed back as context.

Register a factory that returns a name, description, schema, and executor. The harness handles everything else: converting to `ChatCompletionTool`, sending to the model, receiving streamed call deltas, validating arguments, executing, streaming the result, and feeding the tool message back into the next LLM turn.

```ts
toolRegistry.register("knowledge-search", {
  factory: (services) => ({
    name:        "knowledge-search",
    description: "Search the knowledge graph for facts about a topic",
    schema: z.object({
      query:  z.string().describe("The search query"),
      limit:  z.number().optional().default(10),
    }),
    async execute({ query, limit }) {
      const results = await services.database.searchKnowledge(query, limit);
      return { type: "text", value: JSON.stringify(results) };
    },
  }),
});
```

The LLM calls it. The harness runs it. The result flows back as a `tool` message. The model continues with full context of what the tool returned.

> **Scales by:** one `toolRegistry.register` call. No graph changes. No step changes. The tool is available to any graph that exposes it.

---

## 🌐 Services — any real-world system

**What corner it covers:** every external system the harness touches — the LLM provider itself, databases, filesystems, browsers, sandboxes, and anything else.

Services implement standard interfaces. Nothing inside `flows-core` ever imports a concrete adapter — only the interface. Swap the real system without changing a single tool or step.

```
tool.execute(args)
      │
      services.webBrowser.search(query)
      │
      IFlowWebBrowserService        ← interface inside flows-core
            │
            ├── Playwright adapter  ← desktop app
            ├── Fetch adapter       ← edge / serverless
            └── Fake adapter        ← deterministic tests
```

The LLM itself is a service — called through the same contract as everything else:

```ts
// graph/agent/graph.ts — agentNode
const stream = llm.chatCompletions({
  messages:    [...state.messages, ...state.outputMessages],
  tools:       this.combinedTools.map(t => t.tool),
  tool_choice: "auto",
  stream:      true,
});
for await (const chunk of stream) {
  runConfig?.writer?.({ type: "llm", chunk });   // every chunk streams to the host
}
```

Register at boot, resolve at runtime:

```ts
serviceRegistry.registerInstance("llm",       openAIAdapter);
serviceRegistry.registerInstance("webBrowser", playwrightAdapter);
serviceRegistry.registerInstance("database",   postgresAdapter);
serviceRegistry.registerInstance("fs",         nodeFs);

// engine materializes all instances into graph and tool factories
const services = engine.resolveServices();
```

> **Scales by:** one new interface implementation + one `registerInstance`. Every tool and step that uses that interface keeps working unchanged.

---

## 🔁 Everything wired together

```
── boot ──────────────────────────────────────────────────────────────

serviceRegistry.registerInstance("llm",       openAIAdapter)
serviceRegistry.registerInstance("webBrowser", playwrightAdapter)

toolRegistry.register("web-search", { factory: ... })
toolRegistry.register("web-read",   { factory: ... })

stepRegistry.register("web-feature", factory, { injectAfter: "__features__" })

graphRegistry.register("foundation", factory, {
  stepOrder: ["add-system", "__features__", "agent-completion"]
})

── runtime ───────────────────────────────────────────────────────────

engine.createChatGraph("foundation", services, config)
  └─ filterConfig: strips steps/tools absent from this engine's registry
  └─ graphRegistry["foundation"].factory(services, config, { registries })
  └─ FoundationFlow: chains enabled steps as nodes

graph.stream(initialState, { configurable: { lifecycle } })
  │
  add-system     ──► writes system prompt into state.messages
  web-feature    ──► pushes [web_search, web_read] into state.tools
                     registers lifecycle.onFinish("close-sessions", ...)
  agent-loop     ──► merges all tools, calls LLM, loops on tool calls
       │
       LLM ──► tool call "web_search" ──► execute ──► result ──► LLM continues
       │
       final response streamed to host
  │
  last chunk consumed ──► lifecycle.drain()
    onFinish "close-sessions" ──► webBrowser.closeSessions()
    onFinish "save-knowledge" ──► database.saveExtracted()
```

---

## 📐 The scalability contract

| To add... | Do this | Everything else... |
|---|---|---|
| A new flow topology | `graphRegistry.register` | stays unchanged |
| A new context, feature, or transform | `stepRegistry.register` | stays unchanged |
| A side-effect around any node | `lifecycle.onBeforeStart / onAfterEnd / onFinish` | stays unchanged |
| A new LLM-callable action | `toolRegistry.register` | stays unchanged |
| A new real-world system | implement interface → `serviceRegistry.registerInstance` | stays unchanged |
