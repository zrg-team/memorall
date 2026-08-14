import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Loader2, Download, Play, Square } from "lucide-react";
import { QUICK_WALLAMA_LLMS } from "@/constants/wllama";
import { QUICK_WEBLLM_LLMS } from "@/constants/webllm";
import { QUICK_TRANSFORMER_MODELS } from "@/constants/transformer";
import { QUICK_OPENAI_LLMS } from "@/constants/openai";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import type { CurrentModel } from "@/main/hooks/use-current-model";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

interface QuickDownloadModelsProps {
	quickProvider: ServiceProvider;
	downloadedModels: ModelInfo[];
	downloadedOnly: ModelInfo[];
	localModels: ModelInfo[];
	loading: boolean;
	quickDownloadModel: string | null;
	current: CurrentModel | null;
	handleQuickDownload: (
		model:
			| (typeof QUICK_WALLAMA_LLMS)[0]
			| (typeof QUICK_WEBLLM_LLMS)[0]
			| (typeof QUICK_TRANSFORMER_MODELS)[0]
			| (typeof QUICK_OPENAI_LLMS)[0],
		provider: ServiceProvider,
	) => Promise<void>;
}

export const QuickDownloadModels: React.FC<QuickDownloadModelsProps> = ({
	quickProvider,
	downloadedModels,
	downloadedOnly,
	localModels,
	loading,
	quickDownloadModel,
	current,
	handleQuickDownload,
}) => {
	const { t } = useTranslation("llm");
	const currentQuickModels =
		quickProvider === "wllama"
			? QUICK_WALLAMA_LLMS
			: quickProvider === "webllm"
				? QUICK_WEBLLM_LLMS
				: quickProvider === "transformer"
					? QUICK_TRANSFORMER_MODELS
					: QUICK_OPENAI_LLMS; // reuse OpenAI list for local providers too

	return (
		<div className="grid gap-2">
			{currentQuickModels
				// Exclude already-downloaded models from quick list (OpenAI models are always available)
				.filter((model) => {
					if (
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "openai" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "lmstudio" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "ollama"
					) {
						return true; // OpenAI models are always available
					}
					if ("repo" in model) {
						return !downloadedOnly.some((m) =>
							m.id.startsWith(model.repo + "/"),
						);
					} else {
						return !downloadedOnly.some((m) => m.id === model.model);
					}
				})
				.map((model) => {
					const modelId = "repo" in model ? model.repo : model.model;
					const cacheModelId =
						quickProvider === "wllama" && "repo" in model
							? `${model.repo}/${model.filename}`
							: modelId;
					const matchesDownloadedModel = (entry: ModelInfo) => {
						if (entry.provider !== quickProvider) return false;
						if (entry.id === cacheModelId || entry.id === modelId) return true;
						if (
							quickProvider === "wllama" &&
							"repo" in model &&
							entry.id.startsWith(model.repo + "/")
						) {
							return entry.filename === model.filename;
						}
						return false;
					};
					const downloadedEntry = downloadedModels.find(matchesDownloadedModel);
					const isDownloaded =
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "openai" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "lmstudio" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "ollama"
							? (quickProvider as "lmstudio" | "ollama" | "openai") ===
									"lmstudio" ||
								(quickProvider as "lmstudio" | "ollama" | "openai") === "ollama"
								? localModels.some((m) => m.id === modelId)
								: true // OpenAI models are always "available"
							: downloadedEntry?.downloaded === true ||
								downloadedEntry?.loaded === true;
					const isLoaded =
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "openai" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "lmstudio" ||
						(quickProvider as
							| "wllama"
							| "webllm"
							| "openai"
							| "lmstudio"
							| "ollama") === "ollama"
							? serviceManager.llmService.has("openai") &&
								current?.modelId ===
									(model as (typeof QUICK_OPENAI_LLMS)[0]).model &&
								current?.provider ===
									(quickProvider as "lmstudio" | "ollama" | "openai")
							: downloadedEntry?.loaded === true;
					return (
						<div
							key={modelId}
							data-model-id={modelId}
							data-model-provider={quickProvider}
							className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
						>
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<div className="font-medium text-sm">
										{"repo" in model
											? model.repo.split("/")[1]
											: quickProvider === "openai"
												? model.model
												: quickProvider === "transformer"
													? model.model
															.replace("onnx-community/", "")
															.replace("-ONNX", "")
															.replace("-Instruct", "")
													: model.model.split("-")[0]}
									</div>
									{isLoaded && (
										<span className="text-xs text-green-600 font-medium">
											● {t("model.loaded")}
										</span>
									)}
									{isDownloaded && !isLoaded && (
										<span className="text-xs text-gray-500">
											○ {t("model.available")}
										</span>
									)}
								</div>
								<div className="text-xs text-muted-foreground">
									{model.description}
								</div>
								<div className="text-xs text-muted-foreground">
									<span className="font-medium">{model.size}</span>
									{"filename" in model && <span> • {model.filename}</span>}
								</div>
							</div>
							<Button
								size="sm"
								onClick={() => handleQuickDownload(model, quickProvider)}
								disabled={loading || isLoaded}
								variant={isDownloaded ? "outline" : "default"}
							>
								{loading && quickDownloadModel === modelId ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : isLoaded ? (
									<>
										<Square className="w-4 h-4" />
										{t("model.ready")}
									</>
								) : isDownloaded ? (
									<>
										<Play className="w-4 h-4" />
										{(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "openai" ||
										(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "lmstudio" ||
										(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "ollama"
											? serviceManager.llmService.has("openai")
												? t("model.use")
												: t("model.connect")
											: t("model.load")}
									</>
								) : (
									<>
										<Download className="w-4 h-4" />
										{(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "openai" ||
										(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "lmstudio" ||
										(quickProvider as
											| "wllama"
											| "webllm"
											| "openai"
											| "lmstudio"
											| "ollama") === "ollama"
											? serviceManager.llmService.has("openai")
												? t("model.use")
												: t("model.connect")
											: t("model.download")}
									</>
								)}
							</Button>
						</div>
					);
				})}
		</div>
	);
};
