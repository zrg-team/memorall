# Flows Service Independence Refactor

## Principles

### 1. Standard-first interfaces

Every interface must follow an established market standard. If a standard exists, use it — do not invent a new shape.

| Interface | Standard to follow | Why |
|---|---|---|
| LLM completions | OpenAI SDK `client.chat.completions.create()` | Every major provider (OpenAI, Ollama, LM Studio, OpenRouter, Anthropic via compat) speaks this shape |
| Embeddings | OpenAI SDK `client.embeddings.create()` | Same ecosystem compatibility |
| Message types | OpenAI chat message wire format | Already the project's `@/types/openai` — just own the boundary |
| Logger | `console` interface (`info`, `error`, `warn`, `debug`) | Compatible with winston, pino, bunyan, and every Node.js logger out of the box |
| Filesystem | Node.js `fs/promises` method signatures | Works in Node.js natively; any virtual FS (memfs, BrowserFS) implements this shape |
| Database | Generic collection/repository pattern (`collection(name).find(filter)`) | Compatible with SQL, NoSQL, in-memory, and vector stores through one adapter |

**Rule:** if someone familiar with the standard can use the interface without reading docs — it is correct. If the interface requires explanation — it is wrong.

### 2. Environment-agnostic

`flows/` must run without modification in:
- Browser (current)
- Node.js (target for testing and server-side use)
- Edge runtimes (Cloudflare Workers, Deno)
- Test environments (no DOM, no IndexedDB, no real LLM)

This means:
- No browser-only APIs in interface definitions (`BroadcastChannel`, `IndexedDB`, `OPFS`)
- No `node:`-only imports in interface definitions
- No singletons initialized at module load time
- `@langchain/langgraph` not `@langchain/langgraph/web`

### 3. Injection over import

Nothing inside `flows/` reaches out to get its dependencies. Every dependency is passed in. The module receives everything it needs at startup through `AllServices`.

**Consequence:** a caller can run the entire flows module with mocked services, a real OpenAI client, or a local LLM — by changing only what they pass to `AllServices`. Zero changes inside `flows/`.

### 4. Zero domain lock-in in interfaces

Interfaces define behavior contracts, not domain shape. `IFlowDatabase` does not know about nodes, edges, or graphs — it knows about collections and filters. `IFlowFileSystem` does not know about documents or workspaces — it knows about paths and buffers. Domain knowledge lives in the steps and tools that use these interfaces, not in the interfaces themselves.

### 5. Explicit over implicit

No registration via import side-effects. Every feature, step, tool, and graph declares itself through an explicit `register()` function. `registerBuiltins()` is the single entry point that wires everything together. Callers can also register only the parts they need.

---

## Goal

`src/services/flows` is a self-contained module. No file inside it imports from any path outside it. All external dependencies are injected through `AllServices`. The module exposes one entry point — `registerBuiltins()` — and a set of typed interfaces that any compatible implementation can satisfy.

**Result:** drop `flows/` into a plain Node.js project, implement the `AllServices` interfaces, call `registerBuiltins()`, and the full flow engine runs. No Electron, no browser APIs, no application framework required.

**Allowed external runtime dependencies (the only three):**
- `zod` — schema validation
- `nanoid` — ID generation
- `@langchain/langgraph` — graph execution framework

---

## Current Flow Architecture

`src/services/flows` is a complete **agent harness**. The model is a pluggable component (`IFlowLLMService`). The harness manages everything else: execution loop, tool dispatch, memory, context engineering, lifecycle hooks, and extensibility.

---

### Equation

```
Agent = Model + Harness
      = IFlowLLMService + src/services/flows
```

The model contributes reasoning and generation. The harness contributes all structure around it.

---

### Layer Map

```
┌─────────────────────────────────────────────────────────────────┐
│  ENTRY LAYER                                                    │
│  chat-flow-registry  →  flows-service  →  flow-builder-service  │
│  routes graphType + config → initialized, streamable graph      │
└────────────────────────┬────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│  GRAPH / EXECUTION LOOP LAYER  (LangGraph StateGraph)           │
│                                                                 │
│  FoundationFlow  — linear chain of step nodes (config-driven)   │
│  AgentGraph      — ReAct loop: agent ⇄ tool_executor            │
│  KnowledgeGraph  — extraction pipeline                          │
│  StructmemGraph  — structured memory consolidation              │
│                                                                 │
│  graph.base.ts: compile, invoke, stream, addNode, chainNodes,   │
│                 combineTools, message helpers                   │
└──────────┬──────────────────────────┬───────────────────────────┘
           ↓                          ↓
┌──────────────────────┐   ┌─────────────────────────────────────┐
│  STEP MIDDLEWARE     │   │  TOOL / CAPABILITY LAYER            │
│  LAYER               │   │                                     │
│  Nodes in the graph  │   │  tools/web/     tools/fs/           │
│  Execute in sequence │   │  tools/documents/  tools/sandbox/   │
│  or loop             │   │  tools/planner/    tools/co-agent/  │
│                      │   │  tools/active-memory/               │
│  steps/common/       │   │  tools/knowledge-graph.ts           │
│  steps/features/     │   │                                     │
│  steps/knowledge-    │   │  tool-registry.ts                   │
│    retrieval/        │   │  Resolved by name at graph init      │
│  steps/structmem/    │   │  Executed inside toolsNode          │
│                      │   │  Results injected as tool messages  │
│  step-registry.ts    │   └─────────────────────────────────────┘
└──────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  MEMORY / CONTEXT LAYER                                         │
│                                                                 │
│  Working memory   →  state.outputMessages  (per-iteration)      │
│  Session state    →  state.messages        (committed history)  │
│  Long-term memory →  knowledge graph + active-memory tools      │
│  Structured mem   →  structmem graph + steps                    │
│  Runtime vars     →  FlowRuntimeVars (per-run key-value store)  │
│                      passed through LangGraph configurable      │
│                                                                 │
│  Context injection steps:                                       │
│    context-smart-retrieve  — vector RAG                         │
│    context-quick-retrieve  — fast keyword retrieval             │
│    context-llm-retrieve    — LLM-guided retrieval               │
│    structmem-retrieve      — structured event retrieval         │
│    auto-compact            — context window compaction          │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  LIFECYCLE / HOOKS LAYER                                        │
│  run-lifecycle.ts                                               │
│                                                                 │
│  onFinish(key, cb)      — runs after stream fully consumed      │
│  onBeforeStart(key, cb) — runs before a named node executes     │
│  onAfterEnd(key, cb)    — runs after a named node executes      │
│                                                                 │
│  Used for: save-to-knowledge-graph, save-structmem-events,      │
│  citation extraction, cleanup — decoupled from main flow        │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  PLUGIN / REGISTRY LAYER                                        │
│                                                                 │
│  step-registry.ts         StepTypeRegistry (global TS interface)│
│  tool-registry.ts         ToolTypeRegistry                      │
│  flow-registry.ts         FlowTypeRegistry                      │
│  chat-flow-registry.ts    chat adapter per graph type           │
│  feature-catalog-registry.ts  UI catalog for feature steps      │
└─────────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE / SERVICES LAYER  (AllServices — injected in)   │
│                                                                 │
│  llm              ILLMService         model calls               │
│  embedding        IEmbeddingService   vector search             │
│  database         IDatabaseService    knowledge + flow storage  │
│  documentFileSystem  DocumentFileSystem  file R/W               │
│  webBrowser       IWebBrowserService  web tools                 │
│  sandboxContainer ISandboxContainerService  code execution      │
└─────────────────────────────────────────────────────────────────┘
```

---

### Execution Flow — Foundation Graph (chat request)

```
1. USER INPUT
   messages: ChatCompletionMessageParam[]
   topicId: string (maps to graphId for knowledge scoping)

2. ENTRY
   chatFlowRegistry.create("foundation", services, config)
   → new FoundationFlow(services, config)
   → LangGraph StateGraph compiled: START → step_nodes... → END

3. STEP NODES (run in config order — each is a LangGraph node)

   add-system
     └─ injects system prompt into state.messages

   context-smart-retrieve   (if enabled)
     └─ vector search knowledge graph → injects relevant nodes/edges as context

   context-quick-retrieve / context-llm-retrieve   (if enabled)
     └─ alternative retrieval strategies

   structmem-retrieve   (if enabled)
     └─ loads related structured memory events into messages

   [feature steps]   (each feature step may add tools or messages)
     └─ documents-fs-feature  → adds fs tools to state.tools
     └─ web-feature           → adds web tools to state.tools
     └─ planner-feature       → adds planner tools to state.tools
     └─ active-memory-feature → adds memory tools, registers onFinish lifecycle
     └─ knowledge-grow        → registers onFinish to extract entities/facts
     └─ ... (15+ feature steps)

   agent-completion   (main model call — runs AgentGraph internally)
     └─ See ReAct loop below

4. REACT LOOP  (inside agent-completion → AgentGraph)

   initial node
     └─ normalizes system prompt position in messages

   agent node
     └─ calls services.llm.chatCompletions({ messages, tools, stream: true })
     └─ streams chunks → writer({ type: "llm", chunk })
     └─ accumulates tool_calls from stream deltas

     if tool_calls present:
       └─ writes { role: "assistant", tool_calls } to outputMessages
       └─ routes → tool_executor

     if no tool_calls (finished):
       └─ commits outputMessages + final message into state.messages
       └─ sets state.response
       └─ routes → END

   tool_executor node
     └─ for each tool_call:
          1. resolve executor from executorMap (pre-built at graph init)
          2. emit writer({ type: "execute-start", tool })
          3. parseToolInput(schema, args)
          4. executor.execute(validatedArgs, { state, runtime })
          5. emit result chunks via writer({ type: "llm", chunk })
          6. push { role: "tool", content, tool_call_id } to outputMessages
     └─ routes back → agent node

   [loop until no tool_calls or maxIterations reached]

5. STREAM OUTPUT
   LangGraph streams node updates as they complete
   Custom chunks: { type: "llm" }, { type: "execute-start" }, { type: "actions" }

6. LIFECYCLE DRAIN  (after stream fully consumed)
   runLifecycle.drain()
   └─ calls all registered onFinish callbacks in reverse order
      e.g.: save extracted entities to knowledge graph
            save structured memory events
            write citations

7. OUTPUT
   state.response  — final text response
   state.messages  — full committed message history
```

---

### Key Design Decisions

| Decision | Mechanism | File |
|---|---|---|
| Config-driven step ordering | `UnifiedFlowConfig.steps[]` → node chain | `graph.base.ts:addStepNodes` |
| Working memory vs session state | `outputMessages` (draft) vs `messages` (committed) | `graph/agent/graph.ts` |
| Tool resolution deferred to graph init | `combineTools()` at constructor time | `graph.base.ts:chat.combineTools` |
| After-stream side effects | `FlowRunLifecycle.onFinish` callbacks | `runtime/run-lifecycle.ts` |
| Per-run transient state | `FlowRuntimeVars` in LangGraph `configurable` | `runtime/runtime-context.ts` |
| Feature pluggability | Steps self-register + accumulate tools in state | `feature-catalog-registry.ts` + step files |
| Graph type extensibility | `FlowTypeRegistry` global TS interface + singleton | `flow-registry.ts` |

---

## Root Problems

| # | Problem | Scope |
|---|---|---|
| 1 | `AllServices` imports 6 concrete service types from outside `flows/` | `interfaces/tool.ts` |
| 2 | `@/types/openai` imported directly in 20+ files | Steps, tools, utils, registries |
| 3 | `@/utils/logger` imported in 50+ files | Every step and tool |
| 4 | `@/utils/vector-search`, `@/utils/scoped-graph-query`, `@/utils/embedding-size-config` used in steps | Knowledge steps |
| 5 | `serviceManager` directly imported in `multi-agent-feature.ts` | DI container leak |
| 6 | `@/main/modules/documents/handlers/pdf-extraction` imported in tools | UI-layer → service-layer violation |
| 7 | `interfaces/flow-builder.ts` imports ORM entity types from `@/services/database/types` | Interface file polluted |
| 8 | `@langchain/langgraph/web` used instead of `@langchain/langgraph` | Browser-only, blocks Node.js |
| 9 | `drizzle-orm` operators used directly in step files | ORM leaked into business logic |
| 10 | Steps self-register via import side-effects — no explicit entry point | No plugin contract |

---

## Dependency Graph — Target State

```
flows/interfaces/messages.ts    ← sole boundary to @/types/openai
flows/interfaces/llm.ts         ← imports messages only
flows/interfaces/embedding.ts   ← no external imports
flows/interfaces/database.ts    ← no external imports
flows/interfaces/logger.ts      ← no external imports
flows/interfaces/filesystem.ts  ← no external imports
flows/interfaces/web-browser.ts ← no external imports
flows/interfaces/sandbox.ts     ← no external imports
flows/interfaces/tool.ts        ← imports from above interfaces only
flows/utils/*                   ← imports from interfaces/ only
flows/steps/*                   ← imports from interfaces/, utils/, registries
flows/tools/*                   ← imports from interfaces/, registries
flows/graph/*                   ← imports from interfaces/, steps/, tools/
flows/index.ts                  ← public entry point; exports registerBuiltins()
```

---

## Phase 1 — New Interface Files

All files go in `src/services/flows/interfaces/`. After this phase no file in `interfaces/` imports from outside `flows/`.

---

### 1.1 `interfaces/messages.ts`

Single re-export boundary. This is the **only** file in `flows/` that imports from `@/types/openai`.

```typescript
export type {
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartText,
  ChatCompletionContentPartImage,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionNamedToolChoice,
  ChatCompletionMessageToolCall,
  ChatCompletionChunkToolCall,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatCompletionChunkDelta,
  ChatCompletionChoice,
  ChatCompletionMessage,
  ChatCompletionFinishReason,
  FunctionDefinition,
  ChatMessage,
} from "@/types/openai";
```

All existing `import ... from "@/types/openai"` inside `flows/` redirect to `../interfaces/messages` (or relative equivalent). Types are identical — no runtime cost.

---

### 1.2 `interfaces/llm.ts`

Mirrors the `openai` npm SDK's `client.chat.completions.create()` namespace structure. Any OpenAI-compatible client satisfies this interface without an adapter.

```typescript
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from "./messages";

export interface IFlowLLMService {
  chat: {
    completions: {
      create(
        body: ChatCompletionRequest & { stream?: false },
      ): Promise<ChatCompletionResponse>;
      create(
        body: ChatCompletionRequest & { stream: true },
      ): AsyncIterable<ChatCompletionChunk>;
      create(
        body: ChatCompletionRequest,
      ): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk>;
    };
  };
  models?: {
    list(): Promise<{
      object: "list";
      data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
    }>;
  };
}
```

**Adapter (outside `flows/`, in app layer):**
```typescript
const toFlowLLM = (svc: ILLMService): IFlowLLMService => ({
  chat: { completions: { create: (body) => svc.chatCompletions(body) } },
});
```

---

### 1.3 `interfaces/embedding.ts`

Mirrors the `openai` npm SDK's `client.embeddings.create()` shape. `dimensions` on the service absorbs `@/utils/embedding-size-config` — callers read it directly instead of calling a separate utility.

```typescript
export interface EmbeddingCreateParams {
  input: string | string[];
  model?: string;
  dimensions?: number;
  encoding_format?: "float" | "base64";
}

export interface EmbeddingObject {
  object: "embedding";
  index: number;
  embedding: number[];
}

export interface CreateEmbeddingResponse {
  object: "list";
  model: string;
  data: EmbeddingObject[];
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface IFlowEmbeddingService {
  embeddings: {
    create(params: EmbeddingCreateParams): Promise<CreateEmbeddingResponse>;
  };
  dimensions: number;
}
```

**Adapter (outside `flows/`):**
```typescript
const toFlowEmbedding = (svc: IEmbeddingService, dims: number): IFlowEmbeddingService => ({
  embeddings: {
    create: async ({ input }) => {
      const inputs = Array.isArray(input) ? input : [input];
      const vectors = await svc.textsToVectors(inputs);
      return {
        object: "list",
        model: "",
        data: vectors.map((embedding, index) => ({ object: "embedding" as const, index, embedding })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
      };
    },
  },
  dimensions: dims,
});
```

---

### 1.4 `interfaces/database.ts`

Generic collection/repository pattern — no domain types, no ORM, works with SQL and NoSQL.

```typescript
// Filter operators compatible with SQL and document stores
export interface WhereCondition<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $like?: string;
  $null?: boolean;
  $between?: [T, T];
}

export type WhereClause<T extends Record<string, unknown>> = {
  [K in keyof T]?: T[K] | WhereCondition<T[K]>;
};

export interface FindOptions<T extends Record<string, unknown>> {
  where?: WhereClause<T>;
  select?: (keyof T & string)[];
  orderBy?: Partial<Record<keyof T & string, "asc" | "desc">>;
  limit?: number;
  offset?: number;
}

export interface ICollection<T extends Record<string, unknown>> {
  find(options?: FindOptions<T>): Promise<T[]>;
  findOne(options?: FindOptions<T>): Promise<T | null>;
  count(where?: WhereClause<T>): Promise<number>;
  insert(data: Partial<T> | Partial<T>[]): Promise<T[]>;
  update(where: WhereClause<T>, data: Partial<T>): Promise<number>;
  delete(where: WhereClause<T>): Promise<number>;
  upsert(where: WhereClause<T>, data: Partial<T>): Promise<T>;
}

export interface IFlowDatabase {
  collection<T extends Record<string, unknown>>(name: string): ICollection<T>;
  transaction<T>(fn: (db: IFlowDatabase) => Promise<T>): Promise<T>;
  // Escape hatch for raw SQL / vector similarity queries
  // Returns plain objects — no ORM types cross this boundary
  raw<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>;
}
```

**Usage in steps:**
```typescript
// Before: import { and, inArray } from "drizzle-orm"; IDatabaseService.use(ctx => ...)
// After:
const nodes = await services.database
  .collection<{ id: string; name: string; graphId: string }>("nodes")
  .find({ where: { graphId: { $eq: state.graphId } }, limit: 50 });
```

The row shape `T` is defined by the caller inline. The interface imposes no domain model.

---

### 1.5 `interfaces/logger.ts`

`console.*`-compatible shape. Works in Node.js, browser, and any test environment with zero setup.

```typescript
export interface IFlowLogger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

// Built-in default — used when no logger is injected
export const consoleFlowLogger: IFlowLogger = {
  info:  (msg, ...args) => console.info(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
  warn:  (msg, ...args) => console.warn(msg, ...args),
  debug: (msg, ...args) => console.debug(msg, ...args),
};
```

`logger` is added as a required field to `AllServices`. Steps replace `logInfo("[CTX]", ...)` with `services.logger.info("[CTX]", ...)`. Code that logs outside `execute()` (e.g. at registration time) uses `consoleFlowLogger` directly.

---

### 1.6 `interfaces/filesystem.ts`

Mirrors Node.js `fs/promises` method signatures exactly. Local type definitions (no `import from 'node:fs'`) make it work in browser too. Any Node.js `fs/promises` drops in as-is.

```typescript
export type BufferEncoding =
  | "ascii" | "utf8" | "utf-8" | "utf16le"
  | "ucs2" | "ucs-2" | "base64" | "latin1" | "binary" | "hex";

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  flag?: string;
  mode?: number;
}

// Compatible with Node.js fs.Stats
export interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtime: Date;
  atime: Date;
  ctime: Date;
  birthtime: Date;
  mode: number;
}

// Compatible with Node.js fs.Dirent
export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

// Method names match fs/promises exactly
export interface IFlowFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>;

  writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
  appendFile(path: string, data: string | Uint8Array): Promise<void>;

  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;

  stat(path: string): Promise<FileStat>;
  access(path: string, mode?: number): Promise<void>;

  // Optional — for reactive file watching
  watch?(
    path: string,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): AsyncIterable<{ eventType: "rename" | "change"; filename: string | null }>;
}
```

---

### 1.7 `interfaces/web-browser.ts`

Narrowed subset of `IWebBrowserService` — only the methods web tools actually call. All types redefined locally (no import from `@/services/web-browser`).

```typescript
export type WebBrowserMode = "iframe" | "tab" | "window";

export interface WebSearchMatch {
  text: string;
  context?: string;
  index?: number;
}

export interface WebDomElement {
  text: string;
  html: string;
  attributes: Record<string, string>;
}

export interface WebSessionInfo {
  sessionId: string;
  url: string;
  title?: string;
}

export interface IFlowWebBrowserService {
  isReady(): boolean;
  openSession(args: { url: string; mode?: WebBrowserMode }): Promise<WebSessionInfo>;
  closeSession(sessionId: string): Promise<void>;
  getActiveSessionInfo(): Promise<WebSessionInfo[]>;
  fetchRenderedFallback(args: { url: string; sessionId?: string }): Promise<{ content: string; url: string }>;
  searchInSessionHtml(args: {
    sessionId: string;
    pattern: string;
    isRegex?: boolean;
    caseSensitive?: boolean;
    maxMatches?: number;
  }): Promise<WebSearchMatch[]>;
  queryDomElements(args: { sessionId: string; selector: string }): Promise<WebDomElement[]>;
  performDomAction(args: {
    sessionId: string;
    action: string;
    selector: string;
    value?: string;
  }): Promise<void>;
  waitForPageRender(args: { sessionId: string; timeoutMs?: number }): Promise<{ success: boolean }>;
}
```

---

### 1.8 `interfaces/sandbox.ts`

Narrowed subset of `ISandboxContainerService` — execution, filesystem, packages, servers.

```typescript
export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
}

export interface SandboxServerInfo {
  port: number;
  url: string;
  status: "running" | "stopped";
}

export interface IFlowSandboxService {
  isReady(): boolean;
  executeCode(code: string, options?: { language?: string; timeoutMs?: number }): Promise<SandboxExecResult>;
  executeCommand(command: string, options?: { cwd?: string; timeoutMs?: number }): Promise<SandboxExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<SandboxFileEntry[]>;
  mkdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  installPackage(pkg: string): Promise<{ success: boolean; output: string }>;
  startServer(options: { port?: number; command?: string; template?: string }): Promise<SandboxServerInfo>;
  stopServer(port: number): Promise<void>;
  listServers(): Promise<SandboxServerInfo[]>;
}
```

---

### 1.9 `interfaces/document-processor.ts`

Breaks the layer violation where tools import directly from `@/main/modules/documents/handlers/pdf-extraction`.

```typescript
export interface DocumentPage {
  pageNumber: number;
  text: string;
  markdown?: string;
}

export interface ProcessedDocument {
  title?: string;
  pages: DocumentPage[];
  totalPages: number;
  metadata?: Record<string, unknown>;
}

export interface IDocumentProcessor {
  processPDF(data: ArrayBuffer): Promise<ProcessedDocument>;
  formatAsText(doc: ProcessedDocument, options?: { pageRange?: [number, number] }): string;
  formatAsMarkdown(doc: ProcessedDocument, options?: { pageRange?: [number, number] }): string;
}
```

---

### 1.10 Updated `interfaces/tool.ts` — `AllServices`

After Phase 1, zero external imports:

```typescript
import { z } from "zod";
import type { IFlowLLMService } from "./llm";
import type { IFlowEmbeddingService } from "./embedding";
import type { IFlowDatabase } from "./database";
import type { IFlowLogger } from "./logger";
import type { IFlowFileSystem } from "./filesystem";
import type { IFlowWebBrowserService } from "./web-browser";
import type { IFlowSandboxService } from "./sandbox";
import type { IDocumentProcessor } from "./document-processor";
import type { ChatCompletionToolMessageParam } from "./messages";
import type { FlowRuntimeVars } from "../runtime/runtime-context";

export interface AllServices {
  llm: IFlowLLMService;
  embedding: IFlowEmbeddingService;
  database: IFlowDatabase;
  logger: IFlowLogger;
  sandboxContainer?: IFlowSandboxService;
  webBrowser?: IFlowWebBrowserService;
  documentFileSystem?: IFlowFileSystem;
  documentProcessor?: IDocumentProcessor;
}

// ... rest of tool.ts (BaseTool, ToolFactory, ToolSchema, etc.) unchanged
```

---

## Phase 2 — Move Utilities into `flows/utils/`

### 2.1 `utils/vector-search.ts`

Moved from `@/utils/vector-search`. Uses `IFlowDatabase.raw()` for vector similarity SQL — no drizzle-orm. Uses `IFlowEmbeddingService.embeddings.create()` for vectorizing terms.

```typescript
import type { IFlowDatabase } from "../interfaces/database";
import type { IFlowEmbeddingService } from "../interfaces/embedding";
import type { IFlowLogger } from "../interfaces/logger";

export interface VectorSearchResult<T> {
  item: T;
  similarity: number;
}

export async function vectorSearchNodes(
  db: IFlowDatabase,
  emb: IFlowEmbeddingService,
  logger: IFlowLogger,
  terms: string[],
  limit: number,
  graphId?: string,
): Promise<VectorSearchResult<Record<string, unknown>>[]>

export async function vectorSearchEdges(
  db: IFlowDatabase,
  emb: IFlowEmbeddingService,
  logger: IFlowLogger,
  entityNames: string[],
  resolvedIds: string[],
  limit: number,
  graphId?: string,
): Promise<VectorSearchResult<Record<string, unknown>>[]>
```

Callers (smart-retrieve, knowledge-grow steps) pass `services.database`, `services.embedding`, `services.logger` directly.

### 2.2 `utils/graph-query.ts`

Replaces `@/utils/scoped-graph-query`. The original used `drizzle-orm/pg-core`'s `PgColumn`. Replaced with a `WhereClause` builder compatible with `IFlowDatabase`.

```typescript
import type { WhereClause } from "../interfaces/database";

// Builds a graphId scope filter for IFlowDatabase.collection().find()
export function scopedGraphFilter(
  graphId: string | undefined,
): WhereClause<{ graphId: string }> {
  if (graphId?.trim()) return { graphId: { $eq: graphId } };
  return { graphId: { $null: true } };
}
```

### 2.3 `utils/uuid-mapping.ts` — remove logger import

Constructor gains optional `IFlowLogger` parameter, defaulting to `consoleFlowLogger`. The `@/utils/logger` import is removed.

```typescript
import type { IFlowLogger } from "../interfaces/logger";
import { consoleFlowLogger } from "../interfaces/logger";

export class UuidMapper {
  constructor(private logger: IFlowLogger = consoleFlowLogger) {}
  // ... rest unchanged
}
```

---

## Phase 3 — Fix Specific Violations

### 3.1 `steps/features/multi-agent-feature.ts` — remove `serviceManager`

Identify exactly what `serviceManager` provides in this file, then add a narrowed interface to `interfaces/` and expose it through `AllServices`:

```typescript
// interfaces/co-agent.ts (new — based on what serviceManager provides here)
export interface IFlowCoAgentService {
  // methods TBD from reading the actual usage
}

// AllServices addition
coAgent?: IFlowCoAgentService;
```

### 3.2 PDF extraction layer violation — document tools

Document/PDF tools import from `@/main/modules/documents/handlers/pdf-extraction` (a UI-layer module). These are replaced with `services.documentProcessor`:

```typescript
// Before
import { extractPDF, formatPDFAsText } from "@/main/modules/documents/handlers/pdf-extraction";
const result = formatPDFAsText(await extractPDF(buffer));

// After
const doc = await services.documentProcessor?.processPDF(buffer);
const result = services.documentProcessor?.formatAsText(doc);
```

### 3.3 `interfaces/flow-builder.ts` — remove `@/services/database/types`

`Flow`, `FlowState`, `FlowStep`, `FlowConnection` etc. are ORM entities. Replace with plain TypeScript types defined locally in the file.

### 3.4 `interfaces/step.ts` — fix LangGraph import

```typescript
// Before
import type { LangGraphRunnableConfig } from "@langchain/langgraph/web";

// After — base package works in Node.js and browser
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
```

### 3.5 Step files — remove `drizzle-orm` direct imports

`smart-retrieve.ts` and knowledge-grow steps use `and`, `or`, `inArray` from drizzle-orm directly. After Phase 2:
- Replace drizzle filter expressions with `IFlowDatabase.collection().find()` + `WhereClause`
- Complex vector queries go through `flows/utils/vector-search.ts` which uses `db.raw()`

---

## Phase 4 — Explicit Plugin Registration

Remove import-side-effect registration. Each group exports a `register()` function.

```typescript
// steps/features/multi-agent-feature.ts
export function register() {
  stepRegistry.register("multi-agent-feature", factory, meta);
  featureCatalogRegistry.register(catalogEntry);
}

// tools/web/index.ts
export function register() {
  toolRegistry.register("web_search", createWebSearchTool);
  toolRegistry.register("web_navigate", createWebNavigateTool);
  // ...
}
```

`flows/index.ts` becomes the single entry point:

```typescript
// src/services/flows/index.ts
export function registerBuiltins() {
  // Steps
  registerCommonSteps();
  registerFeatureSteps();
  registerKnowledgeSteps();
  registerStructmemSteps();
  // Tools
  registerWebTools();
  registerFsTools();
  registerDocumentTools();
  registerSandboxTools();
  // Graphs
  registerFoundationGraph();
  registerAgentGraph();
  registerKnowledgeGraph();
  registerStructmemGraph();
}

export { consoleFlowLogger } from "./interfaces/logger";
export type { AllServices } from "./interfaces/tool";
export type { IFlowLLMService } from "./interfaces/llm";
export type { IFlowEmbeddingService } from "./interfaces/embedding";
export type { IFlowDatabase } from "./interfaces/database";
export type { IFlowLogger } from "./interfaces/logger";
export type { IFlowFileSystem } from "./interfaces/filesystem";
// ... other interface exports
```

**Node.js usage after refactor:**
```typescript
import { registerBuiltins, chatFlowRegistry, consoleFlowLogger } from "@memorall/flows";

registerBuiltins();

const result = chatFlowRegistry.create("foundation", {
  llm: myOpenAICompatibleClient,       // satisfies IFlowLLMService directly
  embedding: myEmbeddingAdapter,
  database: myDatabaseAdapter,
  logger: consoleFlowLogger,
});
```

---

## Phase 5 — `featureCatalogRegistry` Typing

Currently a plain `{ register, getAll }` object with no runtime enforcement. Convert to a class matching the `StepRegistryManager` / `ToolRegistryManager` pattern with typed `register(entry: FeatureCatalogStep)`.

---

## Adapters Required (outside `flows/`)

Written once in the app layer. `flows/` has no knowledge of these.

| Adapter | From | To |
|---|---|---|
| `toFlowLLM` | `ILLMService` | `IFlowLLMService` |
| `toFlowEmbedding` | `IEmbeddingService` | `IFlowEmbeddingService` |
| `toFlowDatabase` | `IDatabaseService` | `IFlowDatabase` |
| `toFlowFileSystem` | `DocumentFileSystem` | `IFlowFileSystem` |
| `toFlowWebBrowser` | `IWebBrowserService` | `IFlowWebBrowserService` |
| `toFlowSandbox` | `ISandboxContainerService` | `IFlowSandboxService` |
| `toFlowDocProcessor` | pdf-extraction handler | `IDocumentProcessor` |

---

## Implementation Order

Dependencies must be created before their consumers.

```
Step 1  interfaces/messages.ts           no deps
Step 2  interfaces/logger.ts             no deps; includes consoleFlowLogger
Step 3  interfaces/database.ts           no deps
Step 4  interfaces/embedding.ts          no deps
Step 5  interfaces/llm.ts                depends on messages
Step 6  interfaces/filesystem.ts         no deps
Step 7  interfaces/web-browser.ts        no deps
Step 8  interfaces/sandbox.ts            no deps
Step 9  interfaces/document-processor.ts no deps
Step 10 interfaces/co-agent.ts           no deps (after reading multi-agent-feature usage)
Step 11 interfaces/tool.ts               depends on steps 2–10
Step 12 utils/vector-search.ts           depends on database, embedding, logger interfaces
Step 13 utils/graph-query.ts             depends on database interface
Step 14 utils/uuid-mapping.ts patch      depends on logger interface
Step 15 Fix step files                   depends on steps 1–14
         - redirect @/types/openai → interfaces/messages
         - logInfo/logError → services.logger.*
         - drizzle imports removed, use collection() or utils/vector-search
Step 16 Fix tool files                   depends on steps 1–14
         - redirect @/types/openai → interfaces/messages
         - documentProcessor injection replaces direct pdf import
Step 17 Fix interface files              depends on step 11
         - flow-builder.ts: plain types, no ORM entities
         - step.ts: @langchain/langgraph (not /web)
Step 18 Phase 4: register() + registerBuiltins()
Step 19 Phase 5: featureCatalogRegistry class
Step 20 Write adapters (outside flows/)  depends on all above
```

---

## Files Created

| File | Purpose |
|---|---|
| `interfaces/messages.ts` | Sole OpenAI type boundary |
| `interfaces/llm.ts` | OpenAI SDK-shaped LLM interface |
| `interfaces/embedding.ts` | OpenAI SDK-shaped embedding interface |
| `interfaces/database.ts` | Generic collection/repository interface |
| `interfaces/logger.ts` | Simple logger + console default |
| `interfaces/filesystem.ts` | Node.js fs/promises-shaped FS interface |
| `interfaces/web-browser.ts` | Narrowed web browser interface |
| `interfaces/sandbox.ts` | Narrowed sandbox interface |
| `interfaces/document-processor.ts` | PDF/document processing interface |
| `interfaces/co-agent.ts` | Co-agent interface (replace serviceManager) |
| `utils/vector-search.ts` | Moved from @/utils, uses IFlowDatabase |
| `utils/graph-query.ts` | Replaces @/utils/scoped-graph-query |

## Files Modified

| File | Change |
|---|---|
| `interfaces/tool.ts` | AllServices uses local interfaces only |
| `interfaces/step.ts` | @langchain/langgraph (not /web) |
| `interfaces/flow-builder.ts` | Remove @/services/database/types; plain types |
| `utils/uuid-mapping.ts` | Accept IFlowLogger, remove @/utils/logger |
| `utils/langgraph-stream.ts` | Import from ./messages not @/types/openai |
| `utils/message-query.ts` | Import from ../interfaces/messages |
| `step-registry.ts` | Export register() pattern |
| `tool-registry.ts` | Export register() pattern |
| `index.ts` | Export registerBuiltins() as main entry point |
| All 50+ step files | logger injection; openai type redirect |
| All 50+ tool files | logger injection; openai type redirect; documentProcessor |
| `steps/features/multi-agent-feature.ts` | Remove serviceManager; use services.coAgent |
| `steps/knowledge-retrieval/smart-retrieve.ts` | Remove drizzle; use utils/vector-search |
| Knowledge-grow steps | Remove drizzle; use collection() API |
