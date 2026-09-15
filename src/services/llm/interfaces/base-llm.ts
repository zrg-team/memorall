// Base LLM interface for all LLM implementations

import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type {
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	MediaVoice,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type {
	ImageToolTask,
	ModelCategory,
	TextToolTask,
} from "./model-category";
import type { ToolCapabilityInfo } from "./tool-capability";

// Centralized LLM type definition
export type LLMType =
	| "wllama"
	| "webllm"
	| "transformer"
	| "transformer-direct"
	| "transformer-media"
	| "openai"
	| "custom";

export interface LLMInfo {
	name: string;
	type: LLMType;
	ready: boolean;
}

/**
 * Bytes a local model downloads, by the device it will run on: runtimes pick a
 * different precision per device (full precision on WebGPU, quantized on WASM
 * for transformers.js), so one number would be wrong for someone.
 */
export interface DeviceDownloadSizes {
	webgpu?: number;
	wasm?: number;
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
	/** Download size per device when it differs; `size` is the fallback. */
	sizeByDevice?: DeviceDownloadSizes;
	provider?: string; // Added provider field
	dtype?: string;
	device?: string;
	numThreads?: number;
	modelLoader?: string;
	supportsNativeTools?: boolean;
	supportsVision?: boolean;
	supportsAudio?: boolean;
	webgpuCapabilities?: unknown;
	/** What the model does. Absent means chat (see `modelCategoriesOf`). */
	categories?: ModelCategory[];
	/** Speech models: the voices `audio/speech` accepts. */
	voices?: MediaVoice[];
	/** Languages the model declares, as ISO codes. */
	languages?: string[];
	/** Image-tools models: the task the model performs. */
	imageTask?: ImageToolTask;
	/** Text-tools models: the task the model performs. */
	textTask?: TextToolTask;
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

	// Media endpoints - OpenAI compatible. Optional: a provider implements the
	// ones its models can serve, and `ILLMService` reports the rest as
	// unsupported instead of silently falling back to chat.

	/** POST /v1/audio/speech */
	audioSpeech?(request: SpeechCreateParams): Promise<SpeechResponse>;
	/** POST /v1/audio/speech with `stream_format: "sse"`. */
	audioSpeechStream?(
		request: SpeechCreateParams,
	): AsyncIterableIterator<SpeechStreamEvent>;
	/** POST /v1/audio/transcriptions */
	audioTranscriptions?(
		request: TranscriptionCreateParams,
	): Promise<Transcription>;
	/** POST /v1/audio/transcriptions with `stream: true`. */
	audioTranscriptionsStream?(
		request: TranscriptionCreateParams,
	): AsyncIterableIterator<TranscriptionStreamEvent>;
	/**
	 * POST /v1/images/generations. Always evented: local generation takes long
	 * enough that progress is part of the result.
	 */
	imagesGenerations?(
		request: ImageGenerateParams,
	): AsyncIterableIterator<ImageGenerationStreamEvent>;
	/** POST /v1/images/tools (Memorall extension). */
	imagesTools?(request: ImageToolParams): Promise<ImageToolResponse>;
	/** POST /v1/text/tools (Memorall extension). */
	textTools?(request: TextToolParams): Promise<TextToolResponse>;
}
