# Services and Modules Overview

This document tracks the current shared service layer in `src/services/` and the current main UI module layer in `src/main/modules/`.

## Architecture

The app is organized into three related layers:

- `src/services/`: shared runtime services and infrastructure used across popup, offscreen, background, and embedded contexts
- `src/main/modules/`: feature-oriented UI/domain modules for the main app
- `src/main/pages/`: page entry points that assemble modules or directly consume services

Runtime-specific code also exists under `src/background/` and `src/embedded/`, but the main feature/module layer now lives under `src/main/modules/`.

## Service Bootstrap

### Service Manager
- **Path:** `src/services/service-manager.ts`
- **What:** Central bootstrapper that initializes database, embedding, LLM, sandbox container, web browser, flows, and flow builder services in either full mode or proxy mode.
- **Why:** Keeps heavy implementations in the offscreen/runtime context and lightweight proxies in popup/UI contexts.

### Service Exports
- **Path:** `src/services/index.ts`
- **What:** Shared entrypoint exporting the singleton `serviceManager` plus service namespaces such as sandbox-container and web-browser.
- **Why:** Gives the rest of the app one import surface for shared services.

## Runtime Services Managed by `ServiceManager`

### Database Service
- **Path:** `src/services/database/`
- **What:** Dual-mode database service (`main`, `proxy`, `core`) built around PGlite and Drizzle, with schema/entities for conversations, messages, sources, nodes, edges, topics, activity tracking, and flow-builder state.
- **Key areas:** `entities/`, `migrations/`, `bridges/`, `utils/`
- **Why:** Central persistence layer for app state and knowledge data.
- **Doc:** [database-service.md](./database-service.md)

### Embedding Service
- **Path:** `src/services/embedding/`
- **What:** Main/proxy embedding service with worker, local, and OpenAI-backed implementations plus embedding model helpers.
- **Key areas:** `implementations/`, `interfaces/`
- **Why:** Provides semantic embeddings for retrieval and vector search.
- **Doc:** [embedding-service.md](./embedding-service.md)

### LLM Service
- **Path:** `src/services/llm/`
- **What:** Main/proxy/core LLM service with local and API-backed implementations including `wllama`, `webllm`, transformer-based backends, OpenAI, and local OpenAI adapters.
- **Key areas:** `implementations/`, `interfaces/`, `tools/`, `utils/`
- **Why:** Provides chat completions, agent execution, and model management behind one abstraction.
- **Doc:** [llm-service.md](./llm-service.md)

### Sandbox Container Service
- **Path:** `src/services/sandbox-container/`
- **What:** Browser-hosted sandbox runtime for code execution, file operations, package install, server lifecycle, snapshots, logs, request relaying, and rendered preview capture.
- **Key areas:** `interfaces/`, `types.ts`, `sw-response-utils.ts`
- **Why:** Gives flows and jobs a controlled execution/runtime environment with workspace support.
- **Doc:** Summary only on this page

### Web Browser Service
- **Path:** `src/services/web-browser/`
- **What:** Stateful browser-session service for opening sessions, refreshing pages, querying DOM, waiting for render/selector states, searching HTML, and performing DOM actions.
- **Key areas:** `interfaces/`, `types.ts`, `web-browser-protocol.ts`
- **Why:** Exposes browser automation capabilities to flows and jobs.
- **Doc:** Summary only on this page

### Flows Service
- **Path:** `src/services/flows/`
- **What:** Registry-driven flow runtime that self-registers graphs, steps, and tools, then creates graph instances for agent, knowledge, and knowledge-rag workflows.
- **Key areas:** `graph/`, `steps/`, `tools/`, `runtime/`, `interfaces/`, `utils/`
- **Why:** Orchestrates retrieval, tool usage, and multi-step reasoning pipelines.
- **Doc:** [flows-service.md](./flows-service.md)

### Flow Builder Service
- **Path:** `src/services/flows/flow-builder-service.ts`
- **What:** Database-backed CRUD/configuration layer for editable and predefined flows, saved graph layout, feature flags, flow states, connections, and service bindings.
- **Why:** Separates persisted flow authoring from the runtime flow execution engine.
- **Doc:** Summary only on this page

## Shared Infrastructure in `src/services/`

### Background Jobs
- **Path:** `src/services/background-jobs/`
- **What:** IndexedDB-backed job queue with streaming progress, cross-context Chrome runtime bridging, and handlers for chat, embedding, flow, knowledge graph, remember-save, sandbox, topic, and web-browser operations.
- **Key areas:** `bridges/`, `handlers/`, `idb-job-store.ts`
- **Why:** Moves long-running and cross-context work out of UI request paths while preserving progress and completion notifications.
- **Doc:** [background-jobs.md](./background-jobs.md)

### Shared Storage Service
- **Path:** `src/services/shared-storage/`
- **What:** IndexedDB-backed key-value storage with change broadcasts over `chrome.runtime`.
- **Why:** Synchronizes lightweight shared state across extension contexts.
- **Doc:** [shared-storage.md](./shared-storage.md)

### Filesystem Service
- **Path:** `src/services/filesystem/`
- **What:** ZenFS-backed document/workspace storage with tree caching, cross-context invalidation, workspace persistence, and sandbox mount snapshot support for the root filesystem.
- **Key files:** `document-filesystem.ts`, `fs.ts`
- **Why:** Persists the document library and writable workspace outside the in-memory sandbox runtime.
- **Doc:** Summary only on this page

## `src/services/` Layout

Top-level files:

- `src/services/index.ts`
- `src/services/service-manager.ts`

Top-level folders:

- `src/services/background-jobs/`
- `src/services/database/`
- `src/services/embedding/`
- `src/services/filesystem/`
- `src/services/flows/`
- `src/services/llm/`
- `src/services/sandbox-container/`
- `src/services/shared-storage/`
- `src/services/web-browser/`

## Main UI Modules in `src/main/modules/`

### Activity Tracking Module
- **Path:** `src/main/modules/activity-tracking/`
- **What:** Session/activity capture and timeline UI for tracked user activity, backed by database storage and shared storage config/session state.
- **Key files:** `activity-tracking-service.ts`, `components/`
- **Uses:** Database Service, Shared Storage Service

### Chat Module
- **Path:** `src/main/modules/chat/`
- **What:** Main chat UI, streaming message handling, tool/action renderers, agent settings, and chat job client logic.
- **Key areas:** `components/`, `hooks/`, `services/chat-service.ts`, `utils/`
- **Uses:** Background Jobs, LLM Service, Flows Service

### Debug Module
- **Path:** `src/main/modules/debug/`
- **What:** Debug utilities and controls for vector-related inspection/search helpers used by development/debug views.
- **Key files:** `components/SearchControls.tsx`, `utils/vector-search.ts`, `utils/vector-table-config.ts`
- **Uses:** Database and embedding-related diagnostics

### Documents Module
- **Path:** `src/main/modules/files/`
- **What:** Document library UI, workspace tree UI, editors, upload/extraction flows, topic assignment, and knowledge-conversion hooks.
- **Key areas:** `components/`, `editors/`, `handlers/`, `hooks/`, `modals/`, `services/`
- **Uses:** Filesystem Service, Topics Module, Knowledge Module

### Flow Builder Module
- **Path:** `src/main/modules/flow-builder/`
- **What:** Visual flow authoring UI for editing flows, steps, states, service bindings, and graph layout.
- **Key files:** `FlowBuilderPage.tsx`, `components/`
- **Uses:** Flow Builder Service

### Knowledge Module
- **Path:** `src/main/modules/knowledge/`
- **What:** Knowledge-graph visualization and conversion tracking for document/file knowledge extraction.
- **Key files:** `components/D3KnowledgeGraph.tsx`, `services/knowledge-graph-service.ts`
- **Uses:** Database Service, Flows Service, LLM Service, Embedding Service

### LLM Module
- **Path:** `src/main/modules/llm/`
- **What:** Provider/model configuration UI, local model management, download progress hooks, and model recommendation/system-detection utilities.
- **Key areas:** `components/`, `hooks/`, `utils/`, `types/`
- **Uses:** LLM Service

### Supabase Module
- **Path:** `src/main/modules/supabase/`
- **What:** Optional Supabase config/auth integration with auth service, store, hooks, and UI components.
- **Key areas:** `auth/`, `config/`
- **Uses:** Supabase client/auth integration, main app auth flows

### Topics Module
- **Path:** `src/main/modules/topics/`
- **What:** Topic CRUD, topic-file association management, filters, selectors, and topic dialogs.
- **Key areas:** `components/`, `modals/`, `services/topic-service.ts`
- **Uses:** Database Service

## Main Pages in `src/main/pages/`

Pages backed by modules:

- `ActivityTimelinePage.tsx`
- `AuthPage.tsx`
- `ChatPage.tsx`
- `DocumentLibraryPage.tsx`
- `KnowledgeGraphPage.tsx`
- `LLMPage.tsx`
- `FlowBuilderPage/FlowBuilderPage.tsx`

Standalone pages that consume services directly:

- `DatabasePage.tsx`: schema-aware database explorer/query builder over the database service
- `EmbeddingPage.tsx`: vector similarity search UI using embedding + database services
- `LogsPage.tsx`: log viewer/export/clear UI using the app logger

## Other Runtime Folders

- `src/background/`: background worker concerns such as context menu, messaging, and core background runtime
- `src/embedded/`: embedded/content-facing UI and trackers used outside the main app shell
