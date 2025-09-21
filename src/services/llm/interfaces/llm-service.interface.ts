import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./base-llm";

export interface CurrentModelInfo {
	modelId: string;
	provider: ServiceProvider;
	serviceName: string;
}

export type ServiceProvider =
	| "wllama"
	| "webllm"
	| "openai"
	| "lmstudio"
	| "ollama";

export interface ILLMService {
	// Initialization
	initialize(): Promise<void>;

	// LLM management - Core functionality
	create<K extends string>(name: string, config: any): Promise<BaseLLM>;
	get(name: string): Promise<BaseLLM | undefined>;
	has(name: string): boolean;
	remove(name: string): boolean;
	list(): string[];
	clear(): void;

	// Current model management - Core functionality
	getCurrentModel(): Promise<CurrentModelInfo | null>;
	setCurrentModel(modelId: string, provider: ServiceProvider): Promise<void>;
	clearCurrentModel(): Promise<void>;
	onCurrentModelChange(
		listener: (model: CurrentModelInfo | null) => void,
	): () => void;

	// Status - Core functionality
	isReady(): boolean;
	isReadyByName(name: string): boolean;
	getInfo(): { name: string; type: string; ready: boolean };
	getInfoFor(name: string): { name: string; type: string; ready: boolean };

	// Cleanup - Core functionality
	destroy(): void;

	// Model operations - Implementation specific
	models(): Promise<{ object: "list"; data: ModelInfo[] }>;
	modelsFor(name: string): Promise<{ object: "list"; data: ModelInfo[] }>;

	// Chat completions - Implementation specific
	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk>;
	chatCompletionsFor(
		name: string,
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk>;

	// Model serving - Implementation specific
	serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo>;
	serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo>;

	// Model lifecycle - Implementation specific
	unload(modelId: string): Promise<void>;
	unloadFor(name: string, modelId: string): Promise<void>;
	deleteModel(modelId: string): Promise<void>;
	deleteModelFor(name: string, modelId: string): Promise<void>;
}
