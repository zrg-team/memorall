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
		console.log(
			"🔍 updateCurrentModel called with:",
			modelInfo,
			"openaiReady:",
			openaiReady,
		);

		if (!modelInfo) {
			console.log("❌ No model info, setting to null");
			setCurrent(null);
			return;
		}
		if (modelInfo.provider === "openai" && !openaiReady) {
			console.log("❌ OpenAI provider but not ready, setting to null");
			setCurrent(null);
			return;
		}

		console.log("✅ Setting current model:", {
			modelId: modelInfo.modelId,
			provider: modelInfo.provider,
		});
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
		const unsubscribe = serviceManager.llmService.onCurrentModelChange((modelInfo) => {
			console.log("🔔 Current model changed via LLMService:", modelInfo);
			updateCurrentModel(modelInfo);
		});

		return unsubscribe;
	}, [openaiReady]); // Re-subscribe when openaiReady changes

	return { current, setCurrent };
}
