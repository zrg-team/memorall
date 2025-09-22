// Main embedding service file - exports interface and implementations
export type { IEmbeddingService } from "./interfaces/embedding-service.interface";
export { EmbeddingServiceMain } from "./embedding-service-main";
export { EmbeddingServiceProxy } from "./embedding-service-proxy";
export { EmbeddingServiceCore } from "./embedding-service-core";

// Re-export types for compatibility
export type { BaseEmbedding } from "./interfaces/base-embedding";

// Note: Embedding service instances are created by ServiceManager

// Cosine similarity utility function
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
	if (vecA.length !== vecB.length) {
		throw new Error("Vectors must have the same dimension");
	}

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < vecA.length; i++) {
		dotProduct += vecA[i] * vecB[i];
		normA += vecA[i] * vecA[i];
		normB += vecB[i] * vecB[i];
	}

	normA = Math.sqrt(normA);
	normB = Math.sqrt(normB);

	if (normA === 0 || normB === 0) {
		return 0;
	}

	return dotProduct / (normA * normB);
}

// Find most similar vectors
export function findMostSimilar(
	queryVector: number[],
	vectors: number[][],
	topK: number = 5,
): { index: number; similarity: number }[] {
	const similarities = vectors.map((vec, index) => ({
		index,
		similarity: cosineSimilarity(queryVector, vec),
	}));

	return similarities
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, topK);
}
