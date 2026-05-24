export interface EmbeddingCreateParams {
	input: string | string[];
	model?: string;
	dimensions?: number;
	encoding_format?: "float" | "base64";
}

export interface EmbeddingObject {
	object: "embedding";
	index: number;
	embedding: number[];
}

export interface CreateEmbeddingResponse {
	object: "list";
	model: string;
	data: EmbeddingObject[];
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

export interface IFlowEmbeddingService {
	embeddings?: {
		create(params: EmbeddingCreateParams): Promise<CreateEmbeddingResponse>;
	};
	dimensions?: number;
	isReady(): boolean;
	textToVector(text: string): Promise<number[]>;
	textsToVectors?(texts: string[]): Promise<number[][]>;
	get(name: string): Promise<
		| {
				isReady(): boolean;
				textToVector(text: string): Promise<number[]>;
				textsToVectors?(texts: string[]): Promise<number[][]>;
		  }
		| null
		| undefined
	>;
}

export type IEmbeddingService = IFlowEmbeddingService;
export type BaseEmbedding = IFlowEmbeddingService;
