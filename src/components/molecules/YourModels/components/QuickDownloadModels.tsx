import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Play, Square } from "lucide-react";
import { QUICK_WALLAMA_LLMS } from "@/constants/wllama";
import { QUICK_WEBLLM_LLMS } from "@/constants/webllm";
import { QUICK_OPENAI_LLMS } from "@/constants/openai";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import type { Provider } from "../hooks/use-provider-config";
import type { CurrentModel } from "../hooks/use-current-model";

interface QuickDownloadModelsProps {
	quickProvider: Provider;
	downloadedOnly: ModelInfo[];
	localModels: ModelInfo[];
	loading: boolean;
	quickDownloadModel: string | null;
	current: CurrentModel | null;
	handleQuickDownload: (model: any) => Promise<void>;
}

export const QuickDownloadModels: React.FC<QuickDownloadModelsProps> = ({
	quickProvider,
	downloadedOnly,
	localModels,
	loading,
	quickDownloadModel,
	current,
	handleQuickDownload,
}) => {
	const currentQuickModels =
		quickProvider === "wllama"
			? QUICK_WALLAMA_LLMS
			: quickProvider === "webllm"
				? QUICK_WEBLLM_LLMS
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
							: "repo" in model
								? downloadedOnly.some((m) => m.id.startsWith(model.repo + "/"))
								: downloadedOnly.some((m) => m.id === modelId);
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
							: "repo" in model
								? downloadedOnly.some(
										(m) => m.id.startsWith(model.repo + "/") && m.loaded,
									)
								: downloadedOnly.some((m) => m.id === modelId && m.loaded);
					return (
						<div
							key={modelId}
							className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
						>
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<div className="font-medium text-sm">
										{"repo" in model
											? model.repo.split("/")[1]
											: quickProvider === "openai"
												? model.model
												: model.model.split("-")[0]}
									</div>
									{isLoaded && (
										<span className="text-xs text-green-600 font-medium">
											● Loaded
										</span>
									)}
									{isDownloaded && !isLoaded && (
										<span className="text-xs text-gray-500">○ Available</span>
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
								onClick={() => handleQuickDownload(model)}
								disabled={loading || isLoaded}
								variant={isDownloaded ? "outline" : "default"}
							>
								{loading && quickDownloadModel === modelId ? (
									<Loader2 className="w-4 h-4 animate-spin" />
								) : isLoaded ? (
									<>
										<Square className="w-4 h-4" />
										Ready
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
												? "Use"
												: "Connect"
											: "Load"}
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
												? "Use"
												: "Connect"
											: "Get"}
									</>
								)}
							</Button>
						</div>
					);
				})}
		</div>
	);
};
