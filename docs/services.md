Documentation Overview

This folder contains the core service documentation for Memorall. Each document provides architecture, APIs, usage, and best practices for a specific subsystem. Start here for a quick summary, then open the full documents below.

Documents

- Database Service
  - What: Local-first relational store (conversations, messages, sources, graph, vectors) built on PGlite.
  - Why: Persist chats, embeddings, and knowledge-graph data efficiently in the browser.
  - Read: ./database-service.md

- Embedding Service
  - What: Pluggable text embedding providers (local ONNX/transformers, iframe runner, API-based).
  - Why: Turn text into vectors for semantic search and graph features.
  - Read: ./embedding-service.md

- LLM Service
  - What: Pluggable LLM providers (Wllama in-browser GGUF, WebLLM via runner, API-ready design).
  - Why: Uniform chat completions with streaming and model management.
  - Read: ./llm-service.md

- Flows Service
  - What: Agent graphs (LangGraph Web) with a typed base, tools, and a reference SimpleGraph to decide tool use vs direct answers.
  - Why: Orchestrate multi-step reasoning, tool usage, and streaming outputs from LLMs.
  - Read: ./flows-service.md

- Shared Storage Service
  - What: Unified, type-safe wrapper over chrome.storage with cross-context change broadcasting and per-key subscriptions.
  - Why: Keep Background, Offscreen, and UI contexts reliably in sync for persisted state.
  - Read: ./shared-storage.md

- Background Jobs
  - What: Lightweight job queue persisted in IndexedDB for saving content and knowledge-graph conversions with progress tracking.
  - Why: Offload long-running work, provide resilient progress, and keep UIs responsive.
  - Read: ./background-jobs.md

- Remember Service
  - What: Ingest and persist content (pages, selections, user input) with search vectors/embeddings and optional knowledge-graph processing.
  - Why: Capture and organize knowledge for later retrieval, tagging, and analysis.
  - Read: ./remember-service.md

- Knowledge Graph Service
  - What: Converts remembered content into entities and relations via streaming flows, persisting nodes/edges and exposing progress.
  - Why: Structure knowledge for retrieval, reasoning, and visualization.
  - Read: ./knowledge-graph-service.md
