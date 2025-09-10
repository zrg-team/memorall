# 🧩 Knowledge Graph Service Documentation

## 📋 Overview

The Knowledge Graph Service converts remembered content into a graph of entities and relations using a streaming flow. It orchestrates LLM- and embedding-powered steps via `flowsService`, persists results to the database, and tracks conversion progress for UI consumption.

## 🏗️ Architecture

### 🔧 Service Architecture

```mermaid
graph TD
  RC[RememberedContent] --> KGS[KnowledgeGraphService]
  KGS --> FL[FlowsService]
  FL --> LLM[LLMService]
  FL --> EMB[EmbeddingService]
  FL --> DB[(DatabaseService)]
  KGS --> ST[Conversion State Map]
  UI[UI/Pages] -->|subscribe| KGS
  KGS -->|get| DB
```

Key characteristics:
- Streams flow updates and maps them to progress states
- Persists created nodes/edges via the database layer
- Provides retrieval of per-page graph data

## 🛠️ Capabilities

- Convert one or multiple pages into graph entities/relations
- Maintain in-memory conversion progress with listeners
- Retrieve graph data for a page (source, entities, relations)

## 📚 Usage Examples

### 🚀 Convert a Page
```typescript
import { knowledgeGraphService } from '@/services/knowledge-graph';

// Start a conversion (throws internally handled errors into progress state)
await knowledgeGraphService.convertPageToKnowledgeGraph(rememberedPage);

// Subscribe to progress
const unsub = knowledgeGraphService.subscribe((map) => {
  const prog = map.get(rememberedPage.id);
  if (prog) console.log(prog.stage, prog.progress);
});

// Fetch resulting graph data
const data = await knowledgeGraphService.getKnowledgeGraphForPage(rememberedPage.id);
```

### 📦 Batch Conversions
```typescript
await knowledgeGraphService.convertMultiplePages(pages);
```

### 🧹 Manage Progress State
```typescript
knowledgeGraphService.clearCompletedConversions();
knowledgeGraphService.clearConversions();
```

## 📝 API Reference

### 🏢 KnowledgeGraphService
```typescript
// Subscriptions
subscribe(listener: (conversions: Map<string, ConversionProgress>) => void): () => void

// Conversions
async convertPageToKnowledgeGraph(page: RememberedContent): Promise<void>
async convertMultiplePages(pages: RememberedContent[]): Promise<void>

// Retrieval
async getKnowledgeGraphForPage(pageId: string): Promise<KnowledgeGraphData | null>
getConversion(pageId: string): ConversionProgress | undefined
getAllConversions(): ConversionProgress[]

// Cleanup
clearConversions(): void
clearCompletedConversions(): void
```

### 📦 Types (selected)
```typescript
export interface KnowledgeGraphData {
  source: any
  entities: KnowledgeGraphEntity[]
  relations: KnowledgeGraphRelation[]
}

export interface ConversionProgress {
  pageId: string
  pageTitle: string
  pageUrl: string
  status: ConversionStatus
  stage: string
  progress: number
  startedAt: Date
  completedAt?: Date
  error?: string
  knowledgeGraph?: KnowledgeGraphData
  stats?: { entitiesExtracted: number; entitiesResolved: number; factsExtracted: number; factsResolved: number; entitiesCreated: number; relationsCreated: number }
}
```

## ⚙️ Flow Stages

Stages observed in streaming updates include: `load_entities`, `extract_entities`, `resolve_entities`, `extract_facts`, `load_facts`, `resolve_facts`, `extract_temporal`, `save_to_database`. These map to user-facing statuses and progress percentages.

## ⚠️ Error Handling

- If `llmService` is not ready, conversions fail gracefully with status `failed`
- Exceptions are caught and reflected in the `ConversionProgress` error field

## 🔒 Concurrency

- In-memory map makes per-session state fast; run conversions sequentially for batch operations to avoid contention

## 🏆 Best Practices

- Ensure `llmService` is initialized and has a model loaded prior to conversion
- Use `getKnowledgeGraphForPage` to fetch persisted results after completion
- Subscribe to progress to drive UI feedback

