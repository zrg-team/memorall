# Documentation Overview

This folder contains architecture documentation for Memorall's services and modules.

## 🏗️ Architecture

**Services** (`src/services/`)
- Shared infrastructure managed by ServiceManager
- Singleton instances providing core capabilities (database, LLM, embedding, flows)
- Cross-module dependencies

**Modules** (`src/modules/`)
- Domain-specific business logic (chat, knowledge, remember, topics)
- Services and components organized by feature
- Consume shared services from ServiceManager

---

## 📦 Services (Shared Infrastructure)

### Database Service
- **What:** Local-first PGlite database (conversations, messages, sources, nodes, edges, vectors)
- **Why:** Persist all application data efficiently in-browser
- **Doc:** [database-service.md](./database-service.md)

### Embedding Service
- **What:** Pluggable text embedding providers (local ONNX, API-based)
- **Why:** Convert text to vectors for semantic search
- **Doc:** [embedding-service.md](./embedding-service.md)

### LLM Service
- **What:** Pluggable LLM providers (Wllama, WebLLM, API-based)
- **Why:** Uniform chat completions with streaming and model management
- **Doc:** [llm-service.md](./llm-service.md)

### Flows Service
- **What:** Self-registering flow graphs (knowledge, simple, knowledge-rag) with type-safe creation
- **Why:** Orchestrate multi-step reasoning (entity extraction, RAG, tool usage)
- **Doc:** [flows-service.md](./flows-service.md)

### Shared Storage Service
- **What:** Type-safe wrapper over chrome.storage with cross-context sync
- **Why:** Keep Background, Offscreen, and UI contexts in sync
- **Doc:** [shared-storage.md](./shared-storage.md)

### Background Jobs
- **What:** Job queue persisted in IndexedDB with progress tracking
- **Why:** Offload long-running work (content processing, knowledge graphs)
- **Doc:** [background-jobs.md](./background-jobs.md)

---

## 🧩 Modules (Domain-Specific)

### Chat Module (`src/modules/chat/`)
- Chat UI, conversation management, hooks (use-chat)
- Uses: LLM Service, Flows Service (SimpleGraph, KnowledgeRAGFlow)

### Knowledge Module (`src/modules/knowledge/`)
- Knowledge graph visualization and processing service
- Uses: Flows Service (KnowledgeGraphFlow), Database Service

### Remember Module (`src/modules/remember/`)
- Content ingestion (pages, selections, user input)
- Uses: Database Service, Flows Service (knowledge graph processing)

### Topics Module (`src/modules/topics/`)
- Topic management and content categorization
- Uses: Database Service

### Embedding Module (`src/modules/embedding/`)
- Vector search UI and table configuration
- Uses: Embedding Service, Database Service

### Database Module (`src/modules/database/`)
- Database query UI and schema exploration
- Uses: Database Service

### LLM Module (`src/modules/llm/`)
- LLM model configuration UI
- Uses: LLM Service
