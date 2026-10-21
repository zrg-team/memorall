import type {
	CurrentModelInfo,
	ServiceProvider,
} from "./interfaces/llm-service.interface";
import type { LLMRegistry } from "./interfaces/service";

// Shared constants for LLM services
export const DEFAULT_SERVICES = {
	WLLAMA: "wllama",
	WEBLLM: "webllm",
	TRANSFORMER: "transformer",
	TRANSFORMER_MEDIA: "transformer-media",
	OPENAI: "openai",
	OPENROUTER: "openrouter",
	CUSTOM: "custom",
	LMSTUDIO: "lmstudio",
	OLLAMA: "ollama",
} as const;

/** Product default; the generic media loader inspects/downloads it on first use. */
export const DEFAULT_TRANSCRIPTION_MODEL = {
	modelId: "onnx-community/whisper-base",
	provider: "transformer-media",
	serviceName: DEFAULT_SERVICES.TRANSFORMER_MEDIA,
} as const satisfies CurrentModelInfo;

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
	custom: DEFAULT_SERVICES.CUSTOM,
	lmstudio: DEFAULT_SERVICES.LMSTUDIO,
	ollama: DEFAULT_SERVICES.OLLAMA,
};

export const SERVICE_TO_PROVIDER = Object.fromEntries(
	Object.entries(PROVIDER_TO_SERVICE).map(([provider, serviceName]) => [
		serviceName,
		provider,
	]),
) as Partial<Record<string, ServiceProvider>>;

/** A model server the user runs and saves in settings: Ollama, LM Studio. */
export const LOCAL_SERVER_SERVICES = [
	DEFAULT_SERVICES.LMSTUDIO,
	DEFAULT_SERVICES.OLLAMA,
] as const;

export type LocalServerServiceName = (typeof LOCAL_SERVER_SERVICES)[number];

export const isLocalServerService = (
	name: string,
): name is LocalServerServiceName =>
	(LOCAL_SERVER_SERVICES as readonly string[]).includes(name);

/**
 * Written when a local server's settings are saved or removed, so every
 * context (pages, the offscreen document) re-reads them.
 */
export const LOCAL_SERVERS_CHANGED_KEY = "_LOCAL_SERVERS_CHANGED_";

/** The chat model. Agents, cron jobs and knowledge extraction all read it. */
export const CURRENT_MODEL_KEY = "_CURRENT_MODEL_KEY_";

/** Selected model per non-chat category (`CurrentModelsByCategory`). */
export const CURRENT_MODELS_BY_CATEGORY_KEY = "_CURRENT_MODELS_BY_CATEGORY_";

// Global progress event name for all LLM downloads
export const LLM_DOWNLOAD_PROGRESS_EVENT = "llm:download:progress";
