import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import type { Provider } from "./use-provider-config";

export interface CurrentModel {
	modelId: string;
	provider: Provider;
}

/**
 * Unified hook for managing current model state
 * Supports both simple usage (no params) and advanced usage (with params)
 */
export function useCurrentModel(
	openaiReady?: boolean,
	downloadedModelsLength?: number,
) {
	const [model, setModel] = useState<string>("");
	const [current, setCurrent] = useState<CurrentModel | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);

	// Update current model state based on LLMService model info
	const updateCurrentModel = (modelInfo: any) => {
		if (!modelInfo) {
			setModel("");
			setCurrent(null);
			return;
		}

		if (!modelInfo.modelId || !modelInfo.provider) {
			setModel("");
			setCurrent(null);
			return;
		}

		// Apply filters only if parameters are provided (advanced mode)
		if (openaiReady !== undefined) {
			if (
				["lmstudio", "ollama"].includes(modelInfo.provider) &&
				modelInfo.modelId === "local-model"
			) {
				setModel("");
				setCurrent(null);
				return;
			}
			if (modelInfo.provider === "openai" && !openaiReady) {
				setModel("");
				setCurrent(null);
				return;
			}
		}

		setModel(modelInfo.modelId);
		setCurrent({ modelId: modelInfo.modelId, provider: modelInfo.provider });
	};

	// Initial load
	useEffect(() => {
		const loadInitialModel = async () => {
			try {
				const currentModel = await serviceManager.llmService.getCurrentModel();
				updateCurrentModel(currentModel);
				setIsInitialized(true);
			} catch (error) {
				logError("Failed to get current model:", error);
				setModel("");
				setCurrent(null);
				setIsInitialized(true);
			}
		};

		loadInitialModel();
	}, [openaiReady, downloadedModelsLength]);

	// Subscribe to model changes
	useEffect(() => {
		const unsubscribe = serviceManager.llmService.onCurrentModelChange(
			(modelInfo) => {
				setIsInitialized(true);
				updateCurrentModel(modelInfo);
			},
		);

		return unsubscribe;
	}, [openaiReady]);

	// Handle model loaded callback - refresh current model state
	const handleModelLoaded = () => {
		const refreshCurrentModel = async () => {
			try {
				const currentModel = await serviceManager.llmService.getCurrentModel();
				updateCurrentModel(currentModel);
			} catch (error) {
				logError("Failed to get current model:", error);
				setModel("");
				setCurrent(null);
			}
		};
		refreshCurrentModel();
	};

	return {
		model,
		current,
		isInitialized,
		handleModelLoaded,
		setCurrent,
	};
}
