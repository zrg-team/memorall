import { useState, useEffect } from "react";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import { eq } from "drizzle-orm";
import { logError } from "@/utils/logger";
import { serviceManager } from "@/services";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

export function useLocalModels(
	quickProvider: ServiceProvider,
	localConfigExists: boolean | null,
	authProviderReady?: boolean,
	refreshKey = 0,
) {
	const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
	const [localModelsLoading, setLocalModelsLoading] = useState(false);

	// Fetch models from providers when configuration exists
	useEffect(() => {
		let cancelled = false;
		const updateModels = (models: ModelInfo[]) => {
			if (!cancelled) setLocalModels(models);
		};
		const updateLoading = (loading: boolean) => {
			if (!cancelled) setLocalModelsLoading(loading);
		};
		updateModels([]);
		updateLoading(false);
		const fetchLocalModels = async () => {
			// Handle local server providers (lmstudio, ollama)
			if (quickProvider === "lmstudio" || quickProvider === "ollama") {
				if (!localConfigExists) {
					updateModels([]);
					return;
				}

				updateLoading(true);
				try {
					// For local providers, the service is created with their provider name
					// Check if the service exists
					if (serviceManager.llmService.has(quickProvider)) {
						const response =
							await serviceManager.llmService.modelsFor(quickProvider);
						updateModels(response.data);
					} else {
						// Try to create the service from saved configuration
						const configKey =
							quickProvider === "lmstudio"
								? "lmstudio_config"
								: "ollama_config";
						try {
							const row = (
								await serviceManager.databaseService.use(({ db, schema }) =>
									db
										.select()
										.from(schema.configurations)
										.where(eq(schema.configurations.key, configKey)),
								)
							)[0] as unknown as { data?: any } | undefined;

							if (row?.data) {
								// Create the service with the saved configuration
								await serviceManager.llmService.create(quickProvider, {
									type: quickProvider,
									baseURL: row.data.baseUrl,
								} as any);

								// Now fetch models
								const response =
									await serviceManager.llmService.modelsFor(quickProvider);
								updateModels(response.data);
							} else {
								updateModels([]);
							}
						} catch (createErr) {
							logError(`Failed to create ${quickProvider} service:`, createErr);
							updateModels([]);
						}
					}
				} catch (err) {
					logError(`Failed to fetch ${quickProvider} models:`, err);
					updateModels([]);
				} finally {
					updateLoading(false);
				}
				return;
			}

			// Handle cloud API providers (openai, openrouter)
			if (
				quickProvider === "openai" ||
				quickProvider === "openrouter" ||
				quickProvider === "custom"
			) {
				// Check if service exists (means it's been configured and loaded)
				if (!serviceManager.llmService.has(quickProvider)) {
					updateModels([]);
					return;
				}

				updateLoading(true);
				try {
					const response =
						await serviceManager.llmService.modelsFor(quickProvider);
					updateModels(response.data);
				} catch (err) {
					logError(`Failed to fetch ${quickProvider} models:`, err);
					updateModels([]);
				} finally {
					updateLoading(false);
				}
				return;
			}

			// For other providers (wllama, webllm), don't fetch models
			updateModels([]);
		};

		fetchLocalModels();
		return () => {
			cancelled = true;
		};
	}, [quickProvider, localConfigExists, authProviderReady, refreshKey]);

	return { localModels, localModelsLoading };
}
