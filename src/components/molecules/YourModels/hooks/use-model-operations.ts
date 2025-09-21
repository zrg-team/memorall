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
import { DEFAULT_SERVICES } from "@/services/llm/constants";

interface UseModelOperationsProps {
	quickProvider: Provider;
	setCurrent: (current: CurrentModel | null) => void;
	setLoading: (loading: boolean) => void;
	setQuickDownloadModel: (model: string | null) => void;
	setDownloadProgress: (progress: DownloadProgress) => void;
	fetchDownloadedModels: () => Promise<void>;
	downloadedModels: ModelInfo[];
	onModelLoaded?: (modelId: string, provider: Provider) => void;
}

export function useModelOperations({
	quickProvider,
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
		) => {
			setLoading(true);
			const modelName = "repo" in model ? model.repo : model.model;
			setQuickDownloadModel(modelName);
			setDownloadProgress({ loaded: 0, total: 0, percent: 0, text: "" });

			try {
				// For OpenAI/local providers, check if service is available
				if (
					quickProvider === "openai" ||
					quickProvider === "lmstudio" ||
					quickProvider === "ollama"
				) {
					// For all openai-compatible providers, the service is registered as "openai"
					if (!serviceManager.llmService.has("openai")) {
						logError(
							quickProvider === "openai"
								? "OpenAI not configured. Please configure OpenAI in the Advanced section first."
								: "Local LLM not configured. Please configure it in the Advanced section.",
						);
						return;
					}

					// Update current state
					const openaiModel = model as (typeof QUICK_OPENAI_LLMS)[0];
					const providerType =
						quickProvider === "openai" ? "openai" : quickProvider;
					await serviceManager.llmService.setCurrentModel(
						openaiModel.model,
						providerType,
					);
					setCurrent({ modelId: openaiModel.model, provider: providerType });
					logInfo(`${modelName} connected successfully`);

					// Notify parent component
					onModelLoaded?.(openaiModel.model, providerType);
					return;
				}

				await ensureServices();

				// Determine provider and service
				const isWllama = "repo" in model;
				const serviceName = isWllama
					? DEFAULT_SERVICES.WLLAMA
					: DEFAULT_SERVICES.WEBLLM;
				const provider: "wllama" | "webllm" = isWllama ? "wllama" : "webllm";

				// Unload previous model if needed
				const loadedModel = downloadedModels.find((m) => m.loaded);
				if (loadedModel) {
					logInfo(`Unloading previous model: ${loadedModel.id}`);
					const currentServiceName =
						loadedModel.filename || loadedModel.id.includes("/")
							? DEFAULT_SERVICES.WLLAMA
							: DEFAULT_SERVICES.WEBLLM;
					await serviceManager.llmService.unloadFor(
						currentServiceName,
						loadedModel.id,
					);
				}

				let modelId: string;
				if (isWllama) {
					modelId = `${model.repo}/${model.filename}`;
				} else {
					modelId = model.model;
				}

				await serviceManager.llmService.serveFor(
					serviceName,
					modelId,
					(progress: { loaded: number; total: number; percent: number }) => {
						setDownloadProgress({ text: "", ...progress });
					},
				);

				// Update current state
				modelId = isWllama ? model.repo : model.model;
				await serviceManager.llmService.setCurrentModel(modelId, provider);
				setCurrent({ modelId, provider });
				logInfo(`${modelName} downloaded and loaded successfully`);

				// Refresh models list
				await fetchDownloadedModels();

				// Notify parent component
				onModelLoaded?.(modelId, provider);
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				if (msg.includes("already initialized")) {
					const isWllama = "repo" in model;
					const provider: "wllama" | "webllm" | "openai" =
						quickProvider === "openai"
							? "openai"
							: isWllama
								? "wllama"
								: "webllm";
					const modelId = isWllama ? model.repo : model.model;
					await serviceManager.llmService.setCurrentModel(modelId, provider);
					setCurrent({ modelId, provider });
					logInfo(`${modelName} was already loaded`);
					await fetchDownloadedModels();
					onModelLoaded?.(modelId, provider);
				} else {
					logError(
						`Error ${quickProvider === "openai" ? "connecting to" : "downloading"} ${modelName}: ${msg}`,
					);
				}
			} finally {
				setLoading(false);
				setQuickDownloadModel(null);
			}
		},
		[
			quickProvider,
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
		async (modelId: string) => {
			setLoading(true);
			try {
				const model = downloadedModels.find((m) => m.id === modelId);
				if (!model) {
					throw new Error(`Model ${modelId} not found`);
				}

				// Determine if this is a WebLLM or Wllama model based on format
				const isWebLLM = !model.filename && !modelId.includes("/");
				const serviceName = isWebLLM
					? DEFAULT_SERVICES.WEBLLM
					: DEFAULT_SERVICES.WLLAMA;

				// Ensure services are available
				if (isWebLLM) {
					await ensureServices();
				}

				// Unload previous model if any is loaded
				const loadedModel = downloadedModels.find((m) => m.loaded);
				if (loadedModel && loadedModel.id !== modelId) {
					const loadedModelIsWebLLM =
						!loadedModel.filename && !loadedModel.id.includes("/");
					const loadedModelService = loadedModelIsWebLLM
						? DEFAULT_SERVICES.WEBLLM
						: DEFAULT_SERVICES.WLLAMA;

					try {
						await serviceManager.llmService.unloadFor(
							loadedModelService,
							loadedModel.id,
						);
					} catch (unloadErr) {
						logInfo(
							"Failed to unload from specific service, trying default:",
							unloadErr,
						);
						await serviceManager.llmService.unload(loadedModel.id);
					}
				}

				await serviceManager.llmService.serveFor(
					serviceName,
					modelId,
					(progress: { loaded: number; total: number; percent: number }) => {
						setDownloadProgress({ text: "", ...progress });
					},
				);

				// Update current state
				const provider: "wllama" | "webllm" = isWebLLM ? "webllm" : "wllama";
				await serviceManager.llmService.setCurrentModel(modelId, provider);
				setCurrent({ modelId, provider });
				logInfo(`${modelId} loaded successfully`);

				// Refresh models list to update loaded status
				await fetchDownloadedModels();

				// Notify parent component
				onModelLoaded?.(modelId, provider);
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Unknown error";
				if (msg.includes("already initialized")) {
					const model = downloadedModels.find((m) => m.id === modelId);
					const modelIsWebLLM =
						model && !model.filename && !modelId.includes("/");
					const provider: "wllama" | "webllm" = modelIsWebLLM
						? "webllm"
						: "wllama";
					await serviceManager.llmService.setCurrentModel(modelId, provider);
					setCurrent({ modelId, provider });
					logInfo(`${modelId} was already loaded`);
					await fetchDownloadedModels();
					onModelLoaded?.(modelId, provider);
				} else {
					logError(`Error loading ${modelId}: ${msg}`);
				}
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
		async (modelId: string) => {
			setLoading(true);
			try {
				const model = downloadedModels.find((m) => m.id === modelId);
				const isWebLLM = model && !model.filename && !modelId.includes("/");

				if (isWebLLM) {
					const webllmServices = serviceManager.llmService
						.list()
						.filter((name) => name.includes("webllm"));
					let unloaded = false;
					for (const serviceName of webllmServices) {
						try {
							await serviceManager.llmService.unloadFor(serviceName, modelId);
							unloaded = true;
							break;
						} catch (err) {
							// Continue to next service
						}
					}
					if (!unloaded) {
						await serviceManager.llmService.unload(modelId);
					}
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
