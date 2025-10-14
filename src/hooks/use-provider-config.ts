import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import secureSession from "@/utils/secure-session";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

/**
 * Provider configuration metadata
 * Defines how each provider stores and validates its configuration
 */
interface ProviderConfig {
	/** Whether this provider requires API key authentication */
	requiresAuth: boolean;
	/** Secure session key for ready state (for API-based providers) */
	readyKey?: string;
	/** Secure session key for passkey/API key */
	passkeyKey?: string;
	/** Database encryption key for config */
	encryptionKey?: string;
	/** Database configuration key for config */
	configKey?: string;
	/** Whether this provider is local (doesn't require API keys) */
	isLocal: boolean;
}

/**
 * Provider configuration registry
 * Maps each provider to its configuration requirements
 */
const PROVIDER_CONFIGS: Record<ServiceProvider, ProviderConfig> = {
	openai: {
		requiresAuth: true,
		readyKey: "openai_ready",
		passkeyKey: "openai_passkey",
		encryptionKey: "openai_config",
		isLocal: false,
	},
	lmstudio: {
		requiresAuth: false,
		configKey: "lmstudio_config",
		isLocal: true,
	},
	ollama: {
		requiresAuth: false,
		configKey: "ollama_config",
		isLocal: true,
	},
	wllama: {
		requiresAuth: false,
		isLocal: true,
	},
	webllm: {
		requiresAuth: false,
		isLocal: true,
	},
};

/**
 * Provider state
 */
export interface ProviderState {
	ready: boolean;
	passkeyExists: boolean;
	configExists: boolean | null;
}

/**
 * Generic provider configuration hook
 * Supports all AI providers without provider-specific APIs
 */
export function useProviderConfig() {
	// Generic provider states - keyed by provider name
	const [providerStates, setProviderStates] = useState<
		Record<string, ProviderState>
	>({});

	// Local provider config existence
	const [localConfigExists, setLocalConfigExists] = useState<boolean | null>(
		null,
	);

	// Quick provider selection
	const [quickProvider, setQuickProvider] = useState<ServiceProvider>("wllama");

	// Overall ready state - true when all providers are checked and loaded
	const [ready, setReady] = useState(false);

	/**
	 * Generic function to check provider configuration
	 */
	const checkProviderConfig = async (
		provider: ServiceProvider,
	): Promise<ProviderState> => {
		const config = PROVIDER_CONFIGS[provider];

		if (!config.requiresAuth) {
			// Local providers are always ready
			return { ready: true, passkeyExists: false, configExists: null };
		}

		const state: ProviderState = {
			ready: false,
			passkeyExists: false,
			configExists: null,
		};

		// Check ready state
		if (config.readyKey) {
			try {
				state.ready = await secureSession.exists(config.readyKey);
			} catch (_) {
				state.ready = false;
			}
		}

		// Check passkey existence
		if (config.passkeyKey) {
			try {
				state.passkeyExists = await secureSession.exists(config.passkeyKey);
			} catch (_) {
				state.passkeyExists = false;
			}
		}

		// Check encrypted config existence
		if (config.encryptionKey) {
			try {
				const row = (
					await serviceManager.databaseService.use(({ db, schema }) =>
						db
							.select()
							.from(schema.encryption)
							.where(eq(schema.encryption.key, config.encryptionKey!)),
					)
				)[0];
				state.configExists = !!row;
			} catch (_) {
				state.configExists = false;
			}
		}

		return state;
	};

	/**
	 * Update provider state
	 */
	const updateProviderState = async (provider: ServiceProvider) => {
		const state = await checkProviderConfig(provider);
		setProviderStates((prev) => ({ ...prev, [provider]: state }));
	};

	// Initialize all providers on mount
	useEffect(() => {
		const initializeProviders = async () => {
			// Check all providers
			const allProviders = Object.keys(PROVIDER_CONFIGS) as ServiceProvider[];

			for (const provider of allProviders) {
				await updateProviderState(provider);
			}

			// Mark as ready after all providers are checked
			setReady(true);
		};

		initializeProviders();
	}, []);

	// Check local provider configuration when selected
	useEffect(() => {
		const run = async () => {
			const config = PROVIDER_CONFIGS[quickProvider];

			if (!config.isLocal || !config.configKey) {
				setLocalConfigExists(null);
				return;
			}

			try {
				const row = (
					await serviceManager.databaseService.use(({ db, schema }) =>
						db
							.select()
							.from(schema.configurations)
							.where(eq(schema.configurations.key, config.configKey!)),
					)
				)[0];
				setLocalConfigExists(!!row);
			} catch {
				setLocalConfigExists(false);
			}
		};
		run();
	}, [quickProvider]);

	/**
	 * Get state for a specific provider
	 */
	const getState = (provider: ServiceProvider): ProviderState => {
		return (
			providerStates[provider] || {
				ready: false,
				passkeyExists: false,
				configExists: null,
			}
		);
	};

	/**
	 * Set ready state for a provider
	 */
	const setStateReady = (provider: ServiceProvider, isReady: boolean) => {
		setProviderStates((prev) => ({
			...prev,
			[provider]: { ...getState(provider), ready: isReady },
		}));
	};

	/**
	 * Set passkey existence for a provider
	 */
	const setPasskeyExists = (provider: ServiceProvider, exists: boolean) => {
		setProviderStates((prev) => ({
			...prev,
			[provider]: { ...getState(provider), passkeyExists: exists },
		}));
	};

	/**
	 * Set config existence for a provider
	 */
	const setConfigExists = (
		provider: ServiceProvider,
		exists: boolean | null,
	) => {
		setProviderStates((prev) => ({
			...prev,
			[provider]: { ...getState(provider), configExists: exists },
		}));
	};

	return {
		// Overall ready state
		ready,

		// Generic provider state access
		providerStates,
		getState,

		// Generic setters
		setStateReady,
		setPasskeyExists,
		setConfigExists,
		updateProviderState,

		// Local provider config
		localConfigExists,
		setLocalConfigExists,

		// Quick provider selection
		quickProvider,
		setQuickProvider,

		// Utility
		providerConfig: PROVIDER_CONFIGS,
	};
}
