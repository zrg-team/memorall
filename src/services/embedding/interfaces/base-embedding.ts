export interface LocalEmbeddingConfig {
	type: "local";
	modelName?: string;
	normalize?: boolean;
	quantized?: boolean;
	modelId?: string;
}

export interface OpenAIEmbeddingConfig {
	type: "openai";
	modelName?: string;
	apiKey?: string;
	baseUrl?: string;
}

export interface WorkerEmbeddingConfig {
	type: "worker";
	modelName?: string;
	normalize?: boolean;
	quantized?: boolean;
	modelId?: string;
}

export type EmbeddingConfig =
	| LocalEmbeddingConfig
	| OpenAIEmbeddingConfig
	| WorkerEmbeddingConfig;

export interface BaseEmbedding {
	name: string;
	dimensions: number;

	// Single text to vector
	textToVector(text: string): Promise<number[]>;

	// Multiple texts to vectors
	textsToVectors(texts: string[]): Promise<number[][]>;

	// Initialize the embedding model
	initialize(): Promise<void>;

	// Check if ready
	isReady(): boolean;

	// Get model info
	getInfo(): {
		name: string;
		dimensions: number;
		type: "local" | "openai" | "custom";
	};
}
