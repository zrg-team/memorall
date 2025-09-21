// Main embedding service file - exports interface and implementations
export type { IEmbeddingService } from "./interfaces/embedding-service.interface";
export { EmbeddingServiceMain } from "./embedding-service-main";
export { EmbeddingServiceUI } from "./embedding-service-ui";
export { EmbeddingServiceCore } from "./embedding-service-core";

// Re-export types for compatibility
export type { BaseEmbedding } from "./interfaces/base-embedding";
