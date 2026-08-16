export type LLMProvider = "transformer" | "webllm" | "wllama";

export interface TransformerRunnerConfig {
	runtime:
		| "causal_lm"
		| "text_generation_pipeline"
		| "image_text_to_text"
		| "vision2seq"
		| "seq2seq_lm";
	dtype?: string;
	moduleDtype?: Record<string, string>;
	postprocess?: "none" | "gemma_clean";
	processorMode?: "chat_template_images";
	modelClassFallback?: "gemma4" | "florence2";
	webgpuMaxContextTokens?: number;
}

export interface WllamaModelConfig {
	filename: string;
	mmprojFilename?: string;
}

export interface LLMModelConfig {
	id: string;
	provider: LLMProvider;
	displayName: string;
	sizeGB: number;
	sizeLabel: string;
	description: string;
	contextLength: number;
	defaultMaxNewTokens: number;
	kvBytesPerToken: number;
	requiresWebGPU: boolean;
	minMemoryGB: number;
	qualityScore: number;
	performanceScore: number;
	contextScore: number;
	releaseDate: string;
	quickDownload?: boolean;
	runnerConfig?: TransformerRunnerConfig;
	wllamaConfig?: WllamaModelConfig;
	unsupported?: boolean;
	unsupportedReason?: string;
}

export type LLMModelRunConfig =
	| { provider: "transformer"; model: string }
	| { provider: "webllm"; model: string }
	| { provider: "wllama"; repo: string; filename: string };

export interface ModelRuntimeProfile {
	provider: LLMProvider;
	modelId: string;
	sizeGB: number;
	contextLength: number;
	requiresWebGPU: boolean;
	kvBytesPerToken: number;
}

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	transformer: "Transformer (WebGPU)",
	webllm: "WebLLM (MLC)",
	wllama: "Wllama (GGUF)",
};

export function getModelRunConfig(model: LLMModelConfig): LLMModelRunConfig {
	if (model.provider === "wllama") {
		if (!model.wllamaConfig?.filename) {
			throw new Error(`Missing wllama filename for model "${model.id}"`);
		}

		return {
			provider: "wllama",
			repo: model.id,
			filename: model.wllamaConfig.filename,
		};
	}

	return {
		provider: model.provider,
		model: model.id,
	};
}

export function getQuickDownloadModelId(model: LLMModelConfig): string {
	if (model.provider === "wllama" && model.wllamaConfig?.filename) {
		return `${model.id}/${model.wllamaConfig.filename}`;
	}

	return model.id;
}
