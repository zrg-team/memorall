// Base LLM interface for all LLM implementations

import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type { ToolCapabilityInfo } from "./tool-capability";

// Centralized LLM type definition
export type LLMType =
	| "wllama"
	| "webllm"
	| "transformer"
	| "transformer-direct"
	| "openai"
	| "custom";

export interface LLMInfo {
	name: string;
	type: LLMType;
	ready: boolean;
}

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
	downloaded?: boolean; // Model files are downloaded/cached locally
	size?: number;
	provider?: string; // Added provider field
	dtype?: string;
	device?: string;
	numThreads?: number;
	modelLoader?: string;
	supportsNativeTools?: boolean;
	supportsVision?: boolean;
	supportsAudio?: boolean;
	webgpuCapabilities?: unknown;
}

export interface ModelsResponse {
	object: "list";
	data: ModelInfo[];
}

export interface ProgressEvent {
	loaded: number;
	total: number;
	percent: number;
	text?: string;
}

// Base LLM interface
export interface BaseLLM {
	name: string;

	// Initialize the LLM
	initialize(): Promise<void>;

	// Check if ready
	isReady(): boolean;

	// Get maximum tokens supported by the model
	getMaxModelTokens(model?: string): Promise<number>;

	// Get maximum response tokens supported by the model
	getMaxResponseTokens(model?: string): Promise<number>;

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
	getInfo(): LLMInfo;

	// Tool capabilities
	getToolCapabilities(model?: string): Promise<ToolCapabilityInfo>;
	supportsTools(model?: string): Promise<boolean>;
}
