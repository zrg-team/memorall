import { useState, useEffect, useCallback } from "react";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import { logError, logInfo } from "@/utils/logger";
import { DEFAULT_SERVICES } from "@/services/llm/constants";

export function useDownloadedModels() {
	const [downloadedModels, setDownloadedModels] = useState<ModelInfo[]>([]);
	const [modelsLoading, setModelsLoading] = useState(false);

	// Helper: determine if a model entry represents a downloaded model
	const isDownloadedModel = useCallback((m: ModelInfo) => {
		const anyModel = m as unknown as { downloaded?: boolean };
		if (anyModel.downloaded) return true;
		if (m.loaded) return true;
		if (m.filename || typeof m.size === "number") return true;
		return false;
	}, []);

	// Fetch downloaded models from both services
	const fetchDownloadedModels = useCallback(async () => {
		setModelsLoading(true);
		let allModels: ModelInfo[] = [];

		try {
			// Try to get models from Wllama service
			try {
				const response = await serviceManager.llmService.modelsFor(
					DEFAULT_SERVICES.WLLAMA,
				);
				allModels = [...allModels, ...response.data];
			} catch (err) {
				logInfo("Failed to fetch wllama models:", err);
			}

			// Try to get models from WebLLM service
			if (serviceManager.llmService.has(DEFAULT_SERVICES.WEBLLM)) {
				try {
					const response = await serviceManager.llmService.modelsFor(
						DEFAULT_SERVICES.WEBLLM,
					);
					const newModels = response.data.filter(
						(model) => !allModels.some((existing) => existing.id === model.id),
					);
					allModels = [...allModels, ...newModels];
				} catch (err) {
					logInfo("Failed to fetch WebLLM models:", err);
				}
			}

			// Local providers do not contribute downloaded models list here

			setDownloadedModels(allModels);
		} catch (err) {
			logError("Error in fetchDownloadedModels:", err);
		} finally {
			setModelsLoading(false);
		}
	}, []);

	// Fetch downloaded models on component mount
	useEffect(() => {
		fetchDownloadedModels();
	}, [fetchDownloadedModels]);

	// Only show actually downloaded models in "Your Models"
	const downloadedOnly = downloadedModels.filter(isDownloadedModel);

	return {
		downloadedModels,
		downloadedOnly,
		modelsLoading,
		fetchDownloadedModels,
		isDownloadedModel,
	};
}
