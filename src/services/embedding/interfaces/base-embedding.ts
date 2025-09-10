// Base embedding interface
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
