import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";

export const useCurrentModel = () => {
	const [model, setModel] = useState<string>("");
	const [isInitialized, setIsInitialized] = useState(false);

	// Subscribe to current model changes from LLM service
	useEffect(() => {
		// Initial load
		const loadInitialModel = async () => {
			try {
				const current = await serviceManager.llmService.getCurrentModel();
				if (current) {
					setModel(current.modelId);
				} else {
					setModel("");
				}
				setIsInitialized(true);
			} catch (error) {
				logError("Failed to get current model:", error);
				setModel("");
				setIsInitialized(true); // Still set as initialized even if no model
			}
		};

		loadInitialModel();

		// Subscribe to model changes
		const unsubscribe = serviceManager.llmService.onCurrentModelChange(
			(current) => {
				setIsInitialized(true);
				if (current) {
					setModel(current.modelId);
				} else {
					setModel("");
				}
			},
		);

		return unsubscribe;
	}, []);

	// Handle model loaded callback - refresh current model state
	const handleModelLoaded = () => {
		const refreshCurrentModel = async () => {
			try {
				const current = await serviceManager.llmService.getCurrentModel();
				if (current) {
					setModel(current.modelId);
				} else {
					setModel("");
				}
			} catch (error) {
				logError("Failed to get current model:", error);
				setModel("");
			}
		};
		refreshCurrentModel();
	};

	return {
		model,
		isInitialized,
		handleModelLoaded,
	};
};
