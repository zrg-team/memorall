import { useState, useEffect } from "react";
import { type ModelInfo } from "@/services/llm";
import { eq } from "drizzle-orm";
import { logError } from "@/utils/logger";
import { serviceManager } from "@/services";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

export function useLocalModels(
	quickProvider: ServiceProvider,
	localConfigExists: boolean | null,
) {
	const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
	const [localModelsLoading, setLocalModelsLoading] = useState(false);

	// Fetch models from local provider when configuration exists
	useEffect(() => {
		const fetchLocalModels = async () => {
			if (
				(quickProvider !== "lmstudio" && quickProvider !== "ollama") ||
				!localConfigExists
			) {
				setLocalModels([]);
				return;
			}

			setLocalModelsLoading(true);
			try {
				// For local providers, the service is created as "openai" but with local config
				// We need to check if the "openai" service exists and has the right provider type
				if (serviceManager.llmService.has("openai")) {
					const response = await serviceManager.llmService.modelsFor("openai");
					setLocalModels(response.data);
				} else {
					// Try to create the service from saved configuration
					const configKey =
						quickProvider === "lmstudio" ? "lmstudio_config" : "ollama_config";
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
							await serviceManager.llmService.create("openai", {
								type: quickProvider,
								baseURL: row.data.baseUrl,
							} as any);

							// Now fetch models
							const response =
								await serviceManager.llmService.modelsFor("openai");
							setLocalModels(response.data);
						} else {
							setLocalModels([]);
						}
					} catch (createErr) {
						logError(`Failed to create ${quickProvider} service:`, createErr);
						setLocalModels([]);
					}
				}
			} catch (err) {
				logError(`Failed to fetch ${quickProvider} models:`, err);
				setLocalModels([]);
			} finally {
				setLocalModelsLoading(false);
			}
		};

		fetchLocalModels();
	}, [quickProvider, localConfigExists]);

	return { localModels, localModelsLoading };
}
