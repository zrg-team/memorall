// Main embedding service file - exports interface and implementations
export type { IEmbeddingService } from "./interfaces/embedding-service.interface";
export { EmbeddingServiceFull } from "./embedding-service-full";
export { EmbeddingServiceLite } from "./embedding-service-lite";

// Re-export types for compatibility
export type { BaseEmbedding } from "./interfaces/base-embedding";