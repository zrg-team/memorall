import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import type { Provider } from "./use-provider-config";

export interface CurrentModel {
	modelId: string;
	provider: Provider;
}

export function useCurrentModel(
	openaiReady: boolean,
	downloadedModelsLength: number,
) {
	const [current, setCurrent] = useState<CurrentModel | null>(null);

	// Update current model state based on LLMService model info
	const updateCurrentModel = (modelInfo: any) => {
		if (!modelInfo) {
			setCurrent(null);
			return;
		}

		if (!modelInfo.modelId || !modelInfo.provider) {
			setCurrent(null);
			return;
		}

		if (
			["lmstudio", "ollama"].includes(modelInfo.provider) &&
			modelInfo.modelId === "local-model"
		) {
			setCurrent(null);
			return;
		}
		if (modelInfo.provider === "openai" && !openaiReady) {
			setCurrent(null);
			return;
		}
		setCurrent({ modelId: modelInfo.modelId, provider: modelInfo.provider });
	};

	// Initial load when dependencies change
	useEffect(() => {
		const loadCurrentModel = async () => {
			try {
				const cm = await serviceManager.llmService.getCurrentModel();
				updateCurrentModel(cm);
			} catch (_) {
				setCurrent(null);
			}
		};
		loadCurrentModel();
	}, [openaiReady, downloadedModelsLength]);

	// PROPER ARCHITECTURE: Listen to LLMService events, not SharedStorage directly
	useEffect(() => {
		const unsubscribe = serviceManager.llmService.onCurrentModelChange(
			(modelInfo) => {
				console.log("🔔 Current model changed via LLMService:", modelInfo);
				updateCurrentModel(modelInfo);
			},
		);

		return unsubscribe;
	}, [openaiReady]); // Re-subscribe when openaiReady changes

	return { current, setCurrent };
}
