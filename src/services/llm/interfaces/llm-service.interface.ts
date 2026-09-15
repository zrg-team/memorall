import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import type {
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./base-llm";
import type { ModelCategory, WorkspaceMode } from "./model-category";
import type { ToolCapabilityInfo } from "./tool-capability";

export interface CurrentModelInfo {
	modelId: string;
	provider: ServiceProvider;
	serviceName: string;
}

export type ServiceProvider =
	| "wllama"
	| "webllm"
	| "transformer"
	| "transformer-media"
	| "openai"
	| "openrouter"
	| "lmstudio"
	| "ollama";

/** The per-category selections that are not the chat model. */
export type CurrentModelsByCategory = Partial<
	Record<Exclude<WorkspaceMode, "chat">, CurrentModelInfo>
>;

export interface ServeOptions {
	/**
	 * Which selection a successful serve records. Defaults to the category the
	 * model resolves to, so serving a speech model never replaces the chat
	 * model that agents, cron jobs and knowledge extraction run on.
	 */
	category?: WorkspaceMode;
	/** `false` loads the model without recording it as selected. */
	select?: boolean;
}

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
	setCurrentModel(
		provider: ServiceProvider,
		modelId: string,
		serviceName: string,
	): Promise<void>;
	clearCurrentModel(): Promise<void>;
	onCurrentModelChange(
		listener: (model: CurrentModelInfo | null) => void,
	): () => void;

	// Per-category selection. "chat" delegates to the methods above.
	getCurrentModelFor(category: WorkspaceMode): Promise<CurrentModelInfo | null>;
	getCurrentModels(): Promise<CurrentModelsByCategory>;
	setCurrentModelFor(
		category: WorkspaceMode,
		provider: ServiceProvider,
		modelId: string,
		serviceName: string,
	): Promise<void>;
	clearCurrentModelFor(category: WorkspaceMode): Promise<void>;
	/** Clears every selection (chat included) served by `provider`. */
	clearCurrentModelsForProvider(provider: ServiceProvider): Promise<void>;
	onCurrentModelsChange(
		listener: (category: WorkspaceMode, model: CurrentModelInfo | null) => void,
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

	// Get max model tokens - Implementation specific
	getMaxModelTokens(model?: string): Promise<number>;
	getMaxModelTokensFor(name: string, model?: string): Promise<number>;

	// Get max response tokens - Implementation specific
	getMaxResponseTokens(model?: string): Promise<number>;
	getMaxResponseTokensFor(name: string, model?: string): Promise<number>;

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
		options?: ServeOptions,
	): Promise<ModelInfo>;
	serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo>;

	// Model lifecycle - Implementation specific
	unload(modelId: string): Promise<void>;
	unloadFor(name: string, modelId: string): Promise<void>;
	deleteModel(modelId: string): Promise<void>;
	deleteModelFor(name: string, modelId: string): Promise<void>;

	// Tool capabilities - Implementation specific
	getToolCapabilities(model?: string): Promise<ToolCapabilityInfo>;
	getToolCapabilitiesFor(
		name: string,
		model?: string,
	): Promise<ToolCapabilityInfo>;
	supportsTools(model?: string): Promise<boolean>;
	supportsToolsFor(name: string, model?: string): Promise<boolean>;

	// Media endpoints - OpenAI compatible. Each throws a clear "not supported"
	// error when the named service does not implement the endpoint.
	supportsCategoryFor(name: string, category: ModelCategory): boolean;
	audioSpeechFor(
		name: string,
		request: SpeechCreateParams,
	): Promise<SpeechResponse>;
	audioSpeechStreamFor(
		name: string,
		request: SpeechCreateParams,
	): AsyncIterableIterator<SpeechStreamEvent>;
	audioTranscriptionsFor(
		name: string,
		request: TranscriptionCreateParams,
	): Promise<Transcription>;
	audioTranscriptionsStreamFor(
		name: string,
		request: TranscriptionCreateParams,
	): AsyncIterableIterator<TranscriptionStreamEvent>;
	imagesGenerationsFor(
		name: string,
		request: ImageGenerateParams,
	): AsyncIterableIterator<ImageGenerationStreamEvent>;
	imagesToolsFor(
		name: string,
		request: ImageToolParams,
	): Promise<ImageToolResponse>;
	textToolsFor(
		name: string,
		request: TextToolParams,
	): Promise<TextToolResponse>;
}
