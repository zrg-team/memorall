import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import type {
	CurrentModelInfo,
	ServiceProvider,
} from "@/services/llm/interfaces/llm-service.interface";

export interface CurrentModel {
	modelId: string;
	provider: ServiceProvider;
}

/**
 * Generic hook for managing current model state
 * Simply reflects the current model from serviceManager.llmService
 * No provider-specific logic or filtering
 *
 * @returns Current model state and control functions
 *
 * @example
 * const { model, current, isInitialized } = useCurrentModel();
 */
export function useCurrentModel() {
	const [model, setModel] = useState<string>("");
	const [current, setCurrent] = useState<CurrentModel | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);

	/**
	 * Update current model state based on LLMService model info
	 */
	const updateCurrentModel = (modelInfo: CurrentModelInfo | null) => {
		if (!modelInfo || !modelInfo.modelId || !modelInfo.provider) {
			setModel("");
			setCurrent(null);
			return;
		}

		setModel(modelInfo.modelId);
		setCurrent({ modelId: modelInfo.modelId, provider: modelInfo.provider });
	};

	// Initial load
	useEffect(() => {
		const loadInitialModel = async () => {
			try {
				const currentModel = await serviceManager.llmService.getCurrentModel();
				if (
					currentModel &&
					!serviceManager.llmService.has(currentModel.serviceName)
				) {
					await serviceManager.llmService.clearCurrentModel();
					updateCurrentModel(null);
					setIsInitialized(true);
					return;
				}
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
	}, []);

	// Subscribe to model changes
	useEffect(() => {
		const unsubscribe = serviceManager.llmService.onCurrentModelChange(
			(modelInfo) => {
				setIsInitialized(true);
				if (
					modelInfo &&
					!serviceManager.llmService.has(modelInfo.serviceName)
				) {
					void serviceManager.llmService.clearCurrentModel().catch((error) => {
						logError("Failed to clear unavailable current model:", error);
					});
					updateCurrentModel(null);
					return;
				}
				updateCurrentModel(modelInfo);
			},
		);

		return unsubscribe;
	}, []);

	/**
	 * Handle model loaded callback - refresh current model state
	 * Used when a new model is loaded/downloaded
	 */
	const handleModelLoaded = (modelId?: string, provider?: ServiceProvider) => {
		const refreshCurrentModel = async () => {
			try {
				const currentModel = await serviceManager.llmService.getCurrentModel();
				if (
					currentModel &&
					!serviceManager.llmService.has(currentModel.serviceName)
				) {
					await serviceManager.llmService.clearCurrentModel();
					updateCurrentModel(null);
					return;
				}
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
