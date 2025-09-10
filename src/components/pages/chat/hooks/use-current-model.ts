import { useState, useEffect } from "react";
import { serviceManager } from "@/services/ServiceManager";
import { llmService } from "@/services/llm";
import { logError } from "@/utils/logger";

export const useCurrentModel = () => {
	const [model, setModel] = useState<string>("");
	const isInitialized = serviceManager.isInitialized();

	// Reflect the current model managed by the service
	useEffect(() => {
		const refreshCurrentModel = async () => {
			if (!isInitialized) return;
			try {
				const current = await llmService.getCurrentModel();
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
	}, [isInitialized]);

	// Handle model loaded callback - refresh current model state
	const handleModelLoaded = () => {
		const refreshCurrentModel = async () => {
			if (!isInitialized) return;
			try {
				const current = await llmService.getCurrentModel();
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
