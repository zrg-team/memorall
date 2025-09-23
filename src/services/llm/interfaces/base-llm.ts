// Base LLM interface for all LLM implementations

import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";

export interface ModelInfo {
	id: string;
	name?: string;
	filename?: string;
	object: "model";
	created: number;
	owned_by: string;
	permission?: unknown[];
	root?: string;
	parent?: string | null;
	loaded: boolean;
	size?: number;
	provider?: string; // Added provider field
}

export interface ModelsResponse {
	object: "list";
	data: ModelInfo[];
}

export interface ProgressEvent {
	loaded: number;
	total: number;
	percent: number;
}

// Base LLM interface
export interface BaseLLM {
	name: string;

	// Initialize the LLM
	initialize(): Promise<void>;

	// Check if ready
	isReady(): boolean;

	// Get available models
	models(): Promise<ModelsResponse>;

	// Chat completions - OpenAI compatible
	chatCompletions(
		request: ChatCompletionRequest & { stream?: false },
	): Promise<ChatCompletionResponse>;
	chatCompletions(
		request: ChatCompletionRequest & { stream: true },
	): AsyncIterableIterator<ChatCompletionChunk>;
	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk>;

	// Unload a model
	unload(modelId: string): Promise<void>;

	// Delete a model
	delete(modelId: string): Promise<void>;

	// Serve/load model from HuggingFace (Wllama-specific)
	serve?(
		modelId: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo>;

	// Get LLM info
	getInfo(): {
		name: string;
		type: "wllama" | "openai" | "custom";
		ready: boolean;
	};
}
