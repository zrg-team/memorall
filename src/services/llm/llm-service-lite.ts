import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { logWarn, logInfo } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import type { ILLMService, CurrentModelInfo, ServiceProvider } from "./interfaces/llm-service.interface";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatLLM } from "./implementations/local-openai-llm";

// Type-safe config mapping for lite services (only lightweight ones)
interface OpenAIConfig {
	type: "openai";
	apiKey?: string;
	baseURL?: string;
}

interface OllamaConfig {
	type: "ollama";
	baseURL?: string;
}

interface LMStudioConfig {
	type: "lmstudio";
	baseURL?: string;
}

interface CustomConfig {
	type: "custom";
	[key: string]: unknown;
}

// Default service names for consistency
export const DEFAULT_SERVICES = {
	OPENAI: "openai",
} as const;

interface LiteLLMRegistry {
	openai: {
		config: OpenAIConfig;
		llm: OpenAILLM;
	};
	ollama: {
		config: OllamaConfig;
		llm: LocalOpenAICompatLLM;
	};
	lmstudio: {
		config: LMStudioConfig;
		llm: LocalOpenAICompatLLM;
	};
	custom: {
		config: CustomConfig;
		llm: BaseLLM;
	};
}

export class LLMServiceLite implements ILLMService {
	private llms = new Map<string, BaseLLM>();
	private currentModel: CurrentModelInfo | null = null;
	private storageUnsubscribe: (() => void) | null = null;
	private storageLoadAttempted = false;
	private static readonly CURRENT_MODEL_KEY = "llm-current-model";

	// Event system for current model changes
	private currentModelListeners = new Set<
		(model: CurrentModelInfo | null) => void
	>();

	// Subscribe to current model changes
	onCurrentModelChange(
		listener: (model: CurrentModelInfo | null) => void,
	): () => void {
		this.currentModelListeners.add(listener);
		return () => this.currentModelListeners.delete(listener);
	}

	// Notify all listeners of current model change
	private notifyCurrentModelChange(): void {
		this.currentModelListeners.forEach((listener) =>
			listener(this.currentModel),
		);
	}

	async initialize(): Promise<void> {
		await sharedStorageService.initialize();

		// Lite mode: Only initialize lightweight services (API-based)
		logInfo("🚀 LLM service initializing in lite mode - heavy operations will use offscreen");
		await this.ensureLiteServices();

		await this.loadCurrentModelFromStorage();
		this.setupStorageListener();
	}

	async create<K extends keyof LiteLLMRegistry>(
		name: string,
		config: LiteLLMRegistry[K]["config"],
	): Promise<LiteLLMRegistry[K]["llm"]> {
		if (this.llms.has(name)) {
			throw new Error(`LLM with name "${name}" already exists`);
		}

		let llm: LiteLLMRegistry[K]["llm"];

		switch (config.type) {
			case "openai":
				llm = new OpenAILLM(
					(config as OpenAIConfig).apiKey,
					(config as OpenAIConfig).baseURL,
				) as LiteLLMRegistry[K]["llm"];
				break;
			case "ollama":
				llm = new LocalOpenAICompatLLM(
					(config as OllamaConfig).baseURL,
				) as LiteLLMRegistry[K]["llm"];
				break;
			case "lmstudio":
				llm = new LocalOpenAICompatLLM(
					(config as LMStudioConfig).baseURL,
				) as LiteLLMRegistry[K]["llm"];
				break;
			case "custom":
				throw new Error("Custom LLM implementation not yet supported");
			default:
				throw new Error("Unknown LLM type");
		}
		this.llms.set(name, llm);

		await llm.initialize();
		return llm;
	}

	async get(name: string): Promise<BaseLLM | undefined> {
		const llm = this.llms.get(name);
		if (llm && !llm.isReady()) {
			await llm.initialize();
		}
		return llm;
	}

	has(name: string): boolean {
		return this.llms.has(name);
	}

	remove(name: string): boolean {
		const llm = this.llms.get(name);
		if (llm && "destroy" in llm) {
			const destroyFn = (llm as { destroy?: () => void }).destroy;
			if (typeof destroyFn === "function") destroyFn.call(llm);
		}
		return this.llms.delete(name);
	}

	list(): string[] {
		return Array.from(this.llms.keys());
	}

	clear(): void {
		for (const [, llm] of this.llms) {
			if ("destroy" in llm) {
				const destroyFn = (llm as { destroy?: () => void }).destroy;
				if (typeof destroyFn === "function") destroyFn.call(llm);
			}
		}
		this.llms.clear();
	}

	// Heavy operations delegated to background jobs
	async models(): Promise<{ object: "list"; data: ModelInfo[] }> {
		try {
			const result = await backgroundJob.execute("get-all-models", {});
			if (result.success && result.data) {
				return result.data.models as { object: "list"; data: ModelInfo[] };
			}
			return { object: "list", data: [] };
		} catch (error) {
			logWarn("Failed to get models via background job:", error);
			return { object: "list", data: [] };
		}
	}

	async modelsFor(name: string): Promise<{ object: "list"; data: ModelInfo[] }> {
		// For lite services, try local first, then delegate if needed
		const llm = await this.get(name);
		if (llm) {
			try {
				return await llm.models();
			} catch (error) {
				logWarn(`Failed to get models for ${name}:`, error);
			}
		}

		// Delegate to background job for heavy services
		try {
			const result = await backgroundJob.execute("get-models-for-service", { serviceName: name });
			if (result.success && result.data) {
				return result.data.models as { object: "list"; data: ModelInfo[] };
			}
		} catch (error) {
			logWarn(`Failed to get models for ${name} via background job:`, error);
		}

		return { object: "list", data: [] };
	}

	chatCompletionsFor(
		name: string,
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (request.stream) {
			const self = this;
			return (async function* () {
				const llm = await self.get(name);
				if (!llm) throw new Error(`LLM "${name}" not found`);
				for await (const chunk of llm.chatCompletions(
					request as ChatCompletionRequest & { stream: true },
				)) {
					yield chunk as ChatCompletionChunk;
				}
			})();
		} else {
			return (async () => {
				const llm = await this.get(name);
				if (!llm) throw new Error(`LLM "${name}" not found`);
				return llm.chatCompletions(
					request as ChatCompletionRequest & { stream?: false },
				) as Promise<ChatCompletionResponse>;
			})();
		}
	}

	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}
		const name = this.currentModel.serviceName;

		if (!this.has(name)) {
			logWarn(`Service not found for chatCompletions:`, {
				requestedService: name,
				currentModel: this.currentModel,
				availableServices: this.list(),
			});
		}

		return this.chatCompletionsFor(name, request);
	}

	// Heavy operations delegated to background jobs
	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		try {
			const result = await backgroundJob.execute("serve-model", {
				modelId: model,
				// Note: onProgress callbacks can't be serialized, so progress updates
				// would need to be handled via job progress updates
			});
			if (result.success && result.data) {
				const modelInfo = result.data.modelInfo as ModelInfo;
				// Update current model based on serve result
				const provider = this.determineProviderFromModel(model);
				await this.setCurrentModel(model, provider);
				return modelInfo;
			}
			throw new Error(result.error || "Failed to serve model");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		// For lite services, try local first
		const llm = await this.get(name);
		if (llm && llm.serve) {
			try {
				const result = await llm.serve(model, onProgress);
				const provider = this.determineProviderFromService(name);
				await this.setCurrentModel(model, provider);
				return result;
			} catch (error) {
				logWarn(`Failed to serve ${model} on ${name}:`, error);
			}
		}

		// Delegate to background job for heavy services
		return this.serve(model, onProgress);
	}

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (llm) {
			return llm.unload(modelId);
		}

		// Delegate to background job if service not available locally
		try {
			const result = await backgroundJob.execute("unload-model", { serviceName: name, modelId });
			if (!result.success) {
				throw new Error(result.error || "Failed to unload model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async deleteModelFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (llm) {
			return llm.delete(modelId);
		}

		// Delegate to background job if service not available locally
		try {
			const result = await backgroundJob.execute("delete-model", { serviceName: name, modelId });
			if (!result.success) {
				throw new Error(result.error || "Failed to delete model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async unload(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.unloadFor(this.currentModel.serviceName, modelId);
	}

	async deleteModel(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.deleteModelFor(this.currentModel.serviceName, modelId);
	}

	isReadyByName(name: string): boolean {
		const llm = this.llms.get(name);
		return llm ? llm.isReady() : false;
	}

	getInfoFor(name: string) {
		const llm = this.llms.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.getInfo();
	}

	isReady(): boolean {
		return (
			this.isReadyByName(DEFAULT_SERVICES.OPENAI) ||
			this.list().some(name => this.isReadyByName(name))
		);
	}

	getInfo() {
		const ready = this.isReady();
		return {
			name: this.currentModel?.serviceName || "unknown",
			type: this.currentModel?.provider || "openai",
			ready,
		};
	}

	// Current model management (shared logic)
	async getCurrentModel(): Promise<CurrentModelInfo | null> {
		if (!this.currentModel && !this.storageLoadAttempted) {
			await this.loadCurrentModelFromStorage();
		}
		return this.currentModel;
	}

	async setCurrentModel(
		modelId: string,
		provider: ServiceProvider,
	): Promise<void> {
		const serviceName = await this.ensureServiceForProvider(provider);
		if (!serviceName) {
			throw new Error(
				`No service found for provider: ${provider}. Available services: ${this.list().join(", ")}`,
			);
		}

		this.currentModel = {
			modelId,
			provider,
			serviceName,
		};

		this.storageLoadAttempted = true;

		try {
			await this.saveCurrentModelToStorage();
		} catch (error) {
			logWarn(`Failed to save current model to storage:`, error);
		}

		this.notifyCurrentModelChange();
	}

	async clearCurrentModel(): Promise<void> {
		this.currentModel = null;
		this.storageLoadAttempted = false;
		await this.saveCurrentModelToStorage();
		this.notifyCurrentModelChange();
	}

	// Cleanup method
	destroy(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
			this.storageUnsubscribe = null;
		}
		this.clear();
	}

	// Private helper methods
	private async ensureLiteServices(): Promise<void> {
		// Only create lightweight services (API-based)
		if (!this.has(DEFAULT_SERVICES.OPENAI)) {
			try {
				await this.create(DEFAULT_SERVICES.OPENAI, { type: "openai" });
			} catch (error) {
				logWarn("Failed to create OpenAI service:", error);
			}
		}

		// Restore local services (Ollama, LMStudio) which are lightweight proxies
		await this.restoreLocalServices();
	}

	private async restoreLocalServices(): Promise<void> {
		try {
			const result = await backgroundJob.execute("restore-local-services", {});

			if (result.success && result.data) {
				const serviceConfigs = result.data.serviceConfigs as Record<
					string,
					{ type: string; baseURL: string }
				>;

				if (serviceConfigs) {
					await this.createLocalServicesFromConfigs(serviceConfigs);
				}
			}
		} catch (error) {
			logWarn("Failed to restore local services via background job:", error);
		}
	}

	private async createLocalServicesFromConfigs(
		serviceConfigs: Record<string, { type: string; baseURL: string }>,
	): Promise<void> {
		if (serviceConfigs.lmstudio) {
			try {
				const lmstudioConfig: LMStudioConfig = {
					type: "lmstudio",
					baseURL: serviceConfigs.lmstudio.baseURL,
				};

				if (this.has("lmstudio")) {
					this.remove("lmstudio");
				}

				await this.create("lmstudio", lmstudioConfig);
			} catch (error) {
				logWarn("Failed to create/update LMStudio service:", error);
			}
		} else {
			if (this.has("lmstudio")) {
				this.remove("lmstudio");
			}
		}

		if (serviceConfigs.ollama) {
			try {
				const ollamaConfig: OllamaConfig = {
					type: "ollama",
					baseURL: serviceConfigs.ollama.baseURL,
				};

				if (this.has("ollama")) {
					this.remove("ollama");
				}

				await this.create("ollama", ollamaConfig);
			} catch (error) {
				logWarn("Failed to create/update Ollama service:", error);
			}
		} else {
			if (this.has("ollama")) {
				this.remove("ollama");
			}
		}
	}

	private determineProviderFromModel(modelId: string): ServiceProvider {
		// Simple heuristic to determine provider from model ID
		if (modelId.includes("gpt") || modelId.includes("openai")) return "openai";
		if (modelId.includes("llama") || modelId.includes("vicuna")) return "wllama";
		return "openai"; // Default fallback
	}

	private determineProviderFromService(serviceName: string): ServiceProvider {
		if (serviceName === "openai") return "openai";
		if (serviceName === "ollama") return "ollama";
		if (serviceName === "lmstudio") return "lmstudio";
		if (serviceName === "wllama") return "wllama";
		if (serviceName === "webllm") return "webllm";
		return "openai"; // Default fallback
	}

	private findServiceNameForProvider(provider: ServiceProvider): string | null {
		const services = this.list();

		if (provider === "openai" && services.includes(DEFAULT_SERVICES.OPENAI)) {
			return DEFAULT_SERVICES.OPENAI;
		}

		for (const serviceName of services) {
			try {
				const serviceInfo = this.getInfoFor(serviceName);
				if (serviceInfo.type === provider) {
					return serviceName;
				}
			} catch (error) {
				continue;
			}
		}

		const matchingService = services.find((name) =>
			name.toLowerCase().includes(provider.toLowerCase()),
		);

		return matchingService || null;
	}

	private async ensureServiceForProvider(
		provider: ServiceProvider,
	): Promise<string | null> {
		let serviceName = this.findServiceNameForProvider(provider);

		if (!serviceName) {
			try {
				await this.restoreLocalServices();
				serviceName = this.findServiceNameForProvider(provider);
			} catch (error) {
				logWarn(`Failed to refresh services for provider ${provider}:`, error);
			}
		}

		return serviceName;
	}

	private async saveCurrentModelToStorage(): Promise<void> {
		try {
			if (!sharedStorageService.isAvailable()) {
				return;
			}

			await sharedStorageService.set(
				LLMServiceLite.CURRENT_MODEL_KEY,
				this.currentModel,
			);
		} catch (error) {
			logWarn("Failed to save current model to storage:", error);
		}
	}

	private async loadCurrentModelFromStorage(): Promise<void> {
		try {
			this.storageLoadAttempted = true;

			if (!sharedStorageService.isAvailable()) {
				return;
			}

			const storedModel = await sharedStorageService.get<CurrentModelInfo>(
				LLMServiceLite.CURRENT_MODEL_KEY,
			);
			if (storedModel) {
				if (storedModel.modelId && storedModel.modelId.trim() !== "") {
					if (storedModel.serviceName && this.has(storedModel.serviceName)) {
						this.currentModel = storedModel;
					} else {
						const correctServiceName = this.findServiceNameForProvider(
							storedModel.provider,
						);
						if (correctServiceName) {
							this.currentModel = {
								...storedModel,
								serviceName: correctServiceName,
							};
							await this.saveCurrentModelToStorage();
						} else {
							this.currentModel = null;
						}
					}
				} else {
					this.currentModel = storedModel;
				}
			}

			this.notifyCurrentModelChange();
		} catch (error) {
			logWarn("Failed to load current model from storage:", error);
		}
	}

	private setupStorageListener(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
		}

		const unsubscribeFunctions: (() => void)[] = [];

		const modelUnsubscribe = sharedStorageService.subscribe<CurrentModelInfo>(
			LLMServiceLite.CURRENT_MODEL_KEY,
			async (event) => {
				if (event.newValue !== this.currentModel) {
					const newModel = event.newValue;

					if (newModel && newModel.provider && newModel.serviceName) {
						if (!this.has(newModel.serviceName)) {
							await this.restoreLocalServices();
						}
					}

					this.currentModel = newModel;
					this.notifyCurrentModelChange();
				}
			},
		);
		unsubscribeFunctions.push(modelUnsubscribe);

		this.storageUnsubscribe = () => {
			unsubscribeFunctions.forEach((fn) => fn());
		};
	}
}