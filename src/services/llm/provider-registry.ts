import type { ServiceProvider } from "./interfaces/llm-service.interface";
import type { ModelCategory } from "./interfaces/model-category";

/**
 * Everything the app knows about a provider, in one place.
 *
 * Before this file the provider list was copied into the models page, the
 * provider tabs, the provider selector, the config hook and the model picker,
 * and a new provider had to be added to all of them by hand. Pure constants, so
 * hooks can import it without pulling the service tree behind it.
 */
export interface ProviderDescriptor {
	id: ServiceProvider;
	/** English fallback; UI resolves `llm:providers.<id>` first. */
	label: string;
	/** Short picker label. */
	shortLabel: string;
	/** Runs on the user's machine (browser runner or local server). */
	isLocal: boolean;
	/**
	 * Holds model weights in this browser's memory. At most one such model is
	 * loaded at a time across all of them (see `ResidencyManager`). Local
	 * servers like Ollama keep their own memory and do not count.
	 */
	residentLocal: boolean;
	requiresAuth: boolean;
	/** Secure-session key that marks an unlocked API key. */
	readyKey?: string;
	/** Encrypted DB row holding the API key. */
	encryptionKey?: string;
	/** Plain configurations row (local servers). */
	configKey?: string;
	/** What models served by this provider can do. */
	categories: readonly ModelCategory[];
}

export const PROVIDER_REGISTRY: Readonly<
	Record<ServiceProvider, ProviderDescriptor>
> = {
	transformer: {
		id: "transformer",
		label: "Transformer",
		shortLabel: "Transformers",
		isLocal: true,
		residentLocal: true,
		requiresAuth: false,
		categories: ["chat"],
	},
	wllama: {
		id: "wllama",
		label: "Wllama",
		shortLabel: "Wllama",
		isLocal: true,
		residentLocal: true,
		requiresAuth: false,
		categories: ["chat"],
	},
	webllm: {
		id: "webllm",
		label: "WebLLM",
		shortLabel: "WebLLM",
		isLocal: true,
		residentLocal: true,
		requiresAuth: false,
		categories: ["chat"],
	},
	"transformer-media": {
		id: "transformer-media",
		label: "Transformers Media",
		shortLabel: "Transformers Media",
		isLocal: true,
		residentLocal: true,
		requiresAuth: false,
		categories: [
			"text-to-speech",
			"speech-to-text",
			"image-tools",
			"text-tools",
			"text-to-audio",
		],
	},
	openai: {
		id: "openai",
		label: "OpenAI",
		shortLabel: "OpenAI",
		isLocal: false,
		residentLocal: false,
		requiresAuth: true,
		readyKey: "openai_ready",
		encryptionKey: "openai_config",
		categories: [
			"chat",
			"text-to-speech",
			"speech-to-text",
			"image-generation",
			"embedding",
		],
	},
	openrouter: {
		id: "openrouter",
		label: "OpenRouter",
		shortLabel: "OpenRouter",
		isLocal: false,
		residentLocal: false,
		requiresAuth: true,
		readyKey: "openrouter_ready",
		encryptionKey: "openrouter_config",
		categories: ["chat", "image-generation"],
	},
	lmstudio: {
		id: "lmstudio",
		label: "LM Studio",
		shortLabel: "LM Studio",
		isLocal: true,
		residentLocal: false,
		requiresAuth: false,
		configKey: "lmstudio_config",
		categories: ["chat"],
	},
	ollama: {
		id: "ollama",
		label: "Ollama",
		shortLabel: "Ollama",
		isLocal: true,
		residentLocal: false,
		requiresAuth: false,
		configKey: "ollama_config",
		categories: ["chat"],
	},
};

/** Display order for tabs, selectors and picker groups. */
export const PROVIDER_ORDER: readonly ServiceProvider[] = [
	"transformer",
	"wllama",
	"webllm",
	"transformer-media",
	"openai",
	"openrouter",
	"lmstudio",
	"ollama",
];

export function getProviderDescriptor(
	provider: ServiceProvider,
): ProviderDescriptor {
	return PROVIDER_REGISTRY[provider];
}

export function isKnownProvider(value: unknown): value is ServiceProvider {
	return typeof value === "string" && value in PROVIDER_REGISTRY;
}

export function providersForCategory(
	category: ModelCategory,
): ServiceProvider[] {
	return PROVIDER_ORDER.filter((provider) =>
		PROVIDER_REGISTRY[provider].categories.includes(category),
	);
}

export function providerSupportsCategory(
	provider: ServiceProvider,
	category: ModelCategory,
): boolean {
	return PROVIDER_REGISTRY[provider]?.categories.includes(category) ?? false;
}

export function isResidentLocalProvider(provider: string | undefined): boolean {
	return isKnownProvider(provider) && PROVIDER_REGISTRY[provider].residentLocal;
}

export const LOCAL_RUNNER_PROVIDERS: ReadonlySet<ServiceProvider> = new Set(
	PROVIDER_ORDER.filter(
		(provider) => PROVIDER_REGISTRY[provider].residentLocal,
	),
);
