import type { BaseEmbedding } from "../interfaces/base-embedding";

export interface IEmbeddingService {
	// Initialization
	initialize(): Promise<void>;

	// Embedding management
	create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding>;
	get(name: string): Promise<BaseEmbedding | null | undefined>;
	has(name: string): boolean;
	remove(name: string): boolean;
	list(): string[];
	clear(): void;

	// Default operations (uses "default" embedding)
	textToVector(text: string): Promise<number[]>;
	textsToVectors(texts: string[]): Promise<number[][]>;

	// Named operations
	textToVectorFor(embeddingName: string, text: string): Promise<number[]>;
	textsToVectorsFor(embeddingName: string, texts: string[]): Promise<number[][]>;

	// Status
	isReady(): boolean;

	// Cleanup
	destroy(): void;
}