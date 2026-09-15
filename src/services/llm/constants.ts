import type { ServiceProvider } from "./interfaces/llm-service.interface";
import type { LLMRegistry } from "./interfaces/service";

// Shared constants for LLM services
export const DEFAULT_SERVICES = {
	WLLAMA: "wllama",
	WEBLLM: "webllm",
	TRANSFORMER: "transformer",
	TRANSFORMER_MEDIA: "transformer-media",
	OPENAI: "openai",
	OPENROUTER: "openrouter",
	LMSTUDIO: "lmstudio",
	OLLAMA: "ollama",
} as const;

export type DefaultOnDemandServiceName =
	| typeof DEFAULT_SERVICES.WLLAMA
	| typeof DEFAULT_SERVICES.WEBLLM
	| typeof DEFAULT_SERVICES.TRANSFORMER
	| typeof DEFAULT_SERVICES.TRANSFORMER_MEDIA;

export const DEFAULT_ON_DEMAND_SERVICE_CONFIGS = {
	[DEFAULT_SERVICES.WLLAMA]: { type: "wllama" },
	[DEFAULT_SERVICES.WEBLLM]: { type: "webllm" },
	[DEFAULT_SERVICES.TRANSFORMER]: { type: "transformer" },
	[DEFAULT_SERVICES.TRANSFORMER_MEDIA]: { type: "transformer-media" },
} as const satisfies {
	[K in DefaultOnDemandServiceName]: LLMRegistry[K]["config"];
};

// Provider to service name mapping
export const PROVIDER_TO_SERVICE: Record<ServiceProvider, string> = {
	wllama: DEFAULT_SERVICES.WLLAMA,
	webllm: DEFAULT_SERVICES.WEBLLM,
	transformer: DEFAULT_SERVICES.TRANSFORMER,
	"transformer-media": DEFAULT_SERVICES.TRANSFORMER_MEDIA,
	openai: DEFAULT_SERVICES.OPENAI,
	openrouter: DEFAULT_SERVICES.OPENROUTER,
	lmstudio: DEFAULT_SERVICES.LMSTUDIO,
	ollama: DEFAULT_SERVICES.OLLAMA,
};

export const SERVICE_TO_PROVIDER = Object.fromEntries(
	Object.entries(PROVIDER_TO_SERVICE).map(([provider, serviceName]) => [
		serviceName,
		provider,
	]),
) as Partial<Record<string, ServiceProvider>>;

/** The chat model. Agents, cron jobs and knowledge extraction all read it. */
export const CURRENT_MODEL_KEY = "_CURRENT_MODEL_KEY_";

/** Selected model per non-chat category (`CurrentModelsByCategory`). */
export const CURRENT_MODELS_BY_CATEGORY_KEY = "_CURRENT_MODELS_BY_CATEGORY_";

// Global progress event name for all LLM downloads
export const LLM_DOWNLOAD_PROGRESS_EVENT = "llm:download:progress";
