// Shared constants for LLM services
export const DEFAULT_SERVICES = {
	WLLAMA: "wllama",
	WEBLLM: "webllm",
	OPENAI: "openai",
} as const;

export type ServiceProvider =
	| "wllama"
	| "webllm"
	| "openai"
	| "lmstudio"
	| "ollama";

export const CURRENT_MODEL_KEY = "_CURRENT_MODEL_KEY_";