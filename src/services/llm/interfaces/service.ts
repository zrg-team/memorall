import type { LocalOpenAICompatibleLLM } from "../implementations/local-openai-llm";
import type { OpenAILLM } from "../implementations/openai-llm";
import type { WebLLMLLM } from "../implementations/webllm-llm";
import type { WllamaLLM } from "../implementations/wllama-llm";
import type { TransformerLLM } from "../implementations/transformer-llm";
import type { TransformerMediaLLM } from "../implementations/transformer-media-llm";
import type { BaseLLM } from "./base-llm";

// Type-safe config mapping for LLMs
export interface WllamaConfig {
	type: "wllama";
	url?: string;
}

export interface WebLLMConfig {
	type: "webllm";
	url?: string;
}

export interface TransformerConfig {
	type: "transformer";
}

export interface TransformerMediaConfig {
	type: "transformer-media";
}

export interface OpenAIConfig {
	type: "openai";
	apiKey?: string;
	baseURL?: string;
}

export interface OllamaConfig {
	type: "ollama";
	baseURL?: string;
}

export interface LMStudioConfig {
	type: "lmstudio";
	baseURL?: string;
}

export interface OpenRouterConfig {
	type: "openrouter";
	apiKey?: string;
	baseURL?: string;
}

export interface CustomConfig {
	type: "custom";
	[key: string]: unknown;
}

// Default service names for consistency
export const DEFAULT_SERVICES = {
	WLLAMA: "wllama",
	WEBLLM: "webllm",
	TRANSFORMER: "transformer",
	OPENAI: "openai",
} as const;

export type ServiceProvider =
	| "wllama"
	| "webllm"
	| "transformer"
	| "transformer-media"
	| "openai"
	| "lmstudio"
	| "ollama"
	| "openrouter";

export interface CurrentModelInfo {
	modelId: string;
	provider: ServiceProvider;
	serviceName: string;
}

export interface LLMRegistry {
	wllama: {
		config: WllamaConfig;
		llm: WllamaLLM;
	};
	webllm: {
		config: WebLLMConfig;
		llm: WebLLMLLM;
	};
	transformer: {
		config: TransformerConfig;
		llm: TransformerLLM;
	};
	"transformer-media": {
		config: TransformerMediaConfig;
		llm: TransformerMediaLLM;
	};
	openai: {
		config: OpenAIConfig;
		llm: OpenAILLM;
	};
	ollama: {
		config: OllamaConfig;
		llm: LocalOpenAICompatibleLLM;
	};
	lmstudio: {
		config: LMStudioConfig;
		llm: LocalOpenAICompatibleLLM;
	};
	openrouter: {
		config: OpenRouterConfig;
		llm: OpenAILLM;
	};
	custom: {
		config: CustomConfig;
		llm: BaseLLM; // Placeholder until implemented
	};
}
