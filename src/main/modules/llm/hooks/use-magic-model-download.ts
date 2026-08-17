import { useCallback } from "react";
import { QUICK_TRANSFORMER_MODELS } from "@/constants/transformer";
import { QUICK_WALLAMA_LLMS } from "@/constants/wllama";
import { QUICK_WEBLLM_LLMS } from "@/constants/webllm";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ModelPreference,
	ModelRecommendation,
} from "../types/system-specs";

type QuickDownloadModel =
	| (typeof QUICK_TRANSFORMER_MODELS)[0]
	| (typeof QUICK_WALLAMA_LLMS)[0]
	| (typeof QUICK_WEBLLM_LLMS)[0];

interface UseMagicModelDownloadProps {
	handleQuickDownload: (
		model: QuickDownloadModel,
		provider: ServiceProvider,
	) => Promise<void>;
}

/**
 * Bridges a MagicSetup recommendation to the quick-download pipeline.
 *
 * Shared by the chat first-run screen and the Models page "Free" path so both
 * resolve a recommendation into a downloadable model the same way.
 */
export function useMagicModelDownload({
	handleQuickDownload,
}: UseMagicModelDownloadProps) {
	return useCallback(
		async (
			recommendation: ModelRecommendation,
			preference?: ModelPreference,
		) => {
			void preference;
			const { config } = recommendation;

			if (config.provider === "transformer") {
				const modelConfig = QUICK_TRANSFORMER_MODELS.find(
					(m) => m.model === config.model,
				) ?? {
					model: config.model,
					size: recommendation.size,
					description: recommendation.displayName,
				};
				await handleQuickDownload(modelConfig, config.provider);
				return;
			}

			if (config.provider === "wllama") {
				const modelConfig = QUICK_WALLAMA_LLMS.find(
					(m) => m.repo === config.repo && m.filename === config.filename,
				) ?? {
					repo: config.repo,
					filename: config.filename,
					size: recommendation.size,
					description: recommendation.displayName,
				};
				await handleQuickDownload(modelConfig, config.provider);
				return;
			}

			if (config.provider === "webllm") {
				const modelConfig = QUICK_WEBLLM_LLMS.find(
					(m) => m.model === config.model,
				) ?? {
					model: config.model,
					size: recommendation.size,
					description: recommendation.displayName,
				};
				await handleQuickDownload(modelConfig, config.provider);
			}
		},
		[handleQuickDownload],
	);
}
