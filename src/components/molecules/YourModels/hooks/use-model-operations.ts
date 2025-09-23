import { useCallback } from "react";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import { QUICK_WALLAMA_LLMS } from "@/constants/wllama";
import { QUICK_WEBLLM_LLMS } from "@/constants/webllm";
import { QUICK_OPENAI_LLMS } from "@/constants/openai";
import { logError, logInfo } from "@/utils/logger";
import type { Provider } from "./use-provider-config";
import type { CurrentModel } from "./use-current-model";
import type { DownloadProgress } from "./use-download-progress";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";

interface UseModelOperationsProps {
	setCurrent: (current: CurrentModel | null) => void;
	setLoading: (loading: boolean) => void;
	setQuickDownloadModel: (model: string | null) => void;
	setDownloadProgress: (progress: DownloadProgress) => void;
	fetchDownloadedModels: () => Promise<void>;
	downloadedModels: ModelInfo[];
	onModelLoaded?: (modelId: string, provider: Provider) => void;
}

export function useModelOperations({
	setCurrent,
	setLoading,
	setQuickDownloadModel,
	setDownloadProgress,
	fetchDownloadedModels,
	downloadedModels,
	onModelLoaded,
}: UseModelOperationsProps) {
	// Initialize services
	const ensureServices = useCallback(async () => {}, []);

	// Quick download a model (supports wllama, webllm, and openai)
	const handleQuickDownload = useCallback(
		async (
			model:
				| (typeof QUICK_WALLAMA_LLMS)[0]
				| (typeof QUICK_WEBLLM_LLMS)[0]
				| (typeof QUICK_OPENAI_LLMS)[0],
			provider: Provider,
		) => {
			setLoading(true);
			const modelName = "repo" in model ? model.repo : model.model;
			setQuickDownloadModel(modelName);
			setDownloadProgress({
				loaded: 0,
				total: 0,
				percent: 0,
				text: "Initializing...",
			});

			try {
				// Use map for provider -> service name
				const serviceName = PROVIDER_TO_SERVICE[provider];

				// Determine model IDs based on provider type
				const modelStructure = {
					wllama: () => {
						const wllamaModel = model as (typeof QUICK_WALLAMA_LLMS)[0];
						return {
							serveModelId: `${wllamaModel.repo}/${wllamaModel.filename}`,
							currentModelId: wllamaModel.repo,
						};
					},
					webllm: () => {
						const webllmModel = model as (typeof QUICK_WEBLLM_LLMS)[0];
						return {
							serveModelId: webllmModel.model,
							currentModelId: webllmModel.model,
						};
					},
					default: () => {
						const openaiModel = model as (typeof QUICK_OPENAI_LLMS)[0];
						return {
							serveModelId: openaiModel.model,
							currentModelId: openaiModel.model,
						};
					},
				};

				const { serveModelId, currentModelId } = (
					modelStructure[provider as keyof typeof modelStructure] ||
					modelStructure.default
				)();

				// Set current model FIRST so serveFor can use provider info
				await serviceManager.llmService.setCurrentModel(
					currentModelId,
					provider,
					serviceName,
				);

				// Always call serveFor - each implementation knows if it needs to download
				await serviceManager.llmService.serveFor(
					serviceName,
					serveModelId,
					(progress) => {
						setDownloadProgress({ text: "", ...progress });
					},
				);
				setCurrent({ modelId: currentModelId, provider });
				logInfo(`${modelName} loaded successfully`);

				// Refresh models list after a brief delay to ensure background service is updated
				setTimeout(async () => {
					await fetchDownloadedModels();
				}, 100);

				// Notify parent component
				onModelLoaded?.(currentModelId, provider);
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				logError(`Error loading ${modelName}: ${msg}`);
			} finally {
				setLoading(false);
				setQuickDownloadModel(null);
				// Clear progress when operation is completely done
				setDownloadProgress({ loaded: 0, total: 0, percent: 0, text: "" });
			}
		},
		[
			setCurrent,
			setLoading,
			setQuickDownloadModel,
			setDownloadProgress,
			fetchDownloadedModels,
			downloadedModels,
			onModelLoaded,
			ensureServices,
		],
	);

	// Load a specific downloaded model
	const loadDownloadedModel = useCallback(
		async (model: ModelInfo, provider: Provider) => {
			setLoading(true);
			const modelId = model.id;
			try {
				const serviceName = provider
					? PROVIDER_TO_SERVICE[provider]
					: undefined;
				// Unload previous model if any is loaded
				const currentDownloadedModels = serviceName
					? await serviceManager.llmService.modelsFor(serviceName)
					: await serviceManager.llmService.models();
				const loadedModel = currentDownloadedModels?.data.find((m) => m.loaded);
				if (loadedModel && loadedModel.id !== modelId) {
					try {
						if (serviceName) {
							await serviceManager.llmService.unloadFor(
								serviceName,
								loadedModel.id,
							);
						} else {
							await serviceManager.llmService.unload(loadedModel.id);
						}
					} catch (unloadErr) {
						logInfo(
							"Failed to unload from specific service, trying default:",
							unloadErr,
						);
						await serviceManager.llmService.unload(loadedModel.id);
					}
				}

				if (serviceName) {
					await serviceManager.llmService.serveFor(
						serviceName,
						modelId,
						(progress: { loaded: number; total: number; percent: number }) => {
							setDownloadProgress({ text: "", ...progress });
						},
					);
				} else {
					await serviceManager.llmService.serve(modelId, (progress) => {
						setDownloadProgress({ text: "", ...progress });
					});
				}

				// Refresh models list to update loaded status after a brief delay
				setTimeout(async () => {
					await fetchDownloadedModels();
				}, 100);

				// Notify parent component
				onModelLoaded?.(modelId, provider as Provider);
			} catch (err) {
				logError(`Error loading ${modelId}`, err);
			} finally {
				setLoading(false);
			}
		},
		[
			downloadedModels,
			setCurrent,
			setLoading,
			setDownloadProgress,
			fetchDownloadedModels,
			onModelLoaded,
			ensureServices,
		],
	);

	// Unload a specific model
	const unloadDownloadedModel = useCallback(
		async (model: ModelInfo, provider: Provider) => {
			setLoading(true);
			const modelId = model.id;
			try {
				const serviceName = provider
					? PROVIDER_TO_SERVICE[provider]
					: undefined;
				if (serviceName) {
					await serviceManager.llmService.unloadFor(serviceName, modelId);
				} else {
					await serviceManager.llmService.unload(modelId);
				}

				logInfo(`${modelId} unloaded`);
				// Clear current banner if unloading the active model
				const currentModel = await serviceManager.llmService.getCurrentModel();
				if (currentModel?.modelId === modelId) {
					await serviceManager.llmService.clearCurrentModel();
					setCurrent(null);
				}
				await fetchDownloadedModels();
			} catch (err) {
				logError(`Error unloading ${modelId}:`, err);
			} finally {
				setLoading(false);
			}
		},
		[downloadedModels, setCurrent, setLoading, fetchDownloadedModels],
	);

	return {
		handleQuickDownload,
		loadDownloadedModel,
		unloadDownloadedModel,
	};
}
