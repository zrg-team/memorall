import type { BaseEmbedding } from "./base-embedding";

export interface IEmbeddingService {
	// Initialization - Core functionality
	initialize(): Promise<void>;

	// Embedding management - Core functionality
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

	// Status - Core functionality
	isReady(): boolean;
	isReadyByName(name: string): boolean;
	getInfo(): { name: string; type: string; ready: boolean };
	getInfoFor(name: string): { name: string; type: string; ready: boolean };

	// Cleanup - Core functionality
	destroy(): void;

	// Embedding operations - Implementation specific
	textToVector(text: string): Promise<number[]>;
	textsToVectors(texts: string[]): Promise<number[][]>;
	textToVectorFor(embeddingName: string, text: string): Promise<number[]>;
	textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]>;
}
