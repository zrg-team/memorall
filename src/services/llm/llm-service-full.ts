import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { logWarn, logInfo } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import { WllamaLLM } from "./implementations/wllama-llm";
import { WebLLMLLM } from "./implementations/webllm-llm";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatLLM } from "./implementations/local-openai-llm";

// Type-safe config mapping for LLMs
interface WllamaConfig {
	type: "wllama";
	url?: string;
}

interface WebLLMConfig {
	type: "webllm";
	url?: string;
}

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
	WLLAMA: "wllama",
	WEBLLM: "webllm",
	OPENAI: "openai",
} as const;

export type ServiceProvider =
	| "wllama"
	| "webllm"
	| "openai"
	| "lmstudio"
	| "ollama";

export interface CurrentModelInfo {
	modelId: string;
	provider: ServiceProvider;
	serviceName: string;
}

interface LLMRegistry {
	wllama: {
		config: WllamaConfig;
		llm: WllamaLLM;
	};
	webllm: {
		config: WebLLMConfig;
		llm: WebLLMLLM;
	};
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
		llm: BaseLLM; // Placeholder until implemented
	};
}

import type { ILLMService } from "./interfaces/llm-service.interface";
import { CURRENT_MODEL_KEY } from "./constants";

export class LLMServiceFull implements ILLMService {
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

	async ensureServiceInOffscreen(
		serviceName: string,
		config: { type: string; baseURL?: string },
	): Promise<void> {
		try {
			if (typeof chrome !== "undefined" && chrome.runtime) {
				const message = {
					type: "ENSURE_LLM_SERVICE",
					serviceName,
					config,
				};
				await chrome.runtime.sendMessage(message);
			}
		} catch (error) {
			logWarn(`Failed to sync service ${serviceName} to offscreen:`, error);
		}
	}

	async create<K extends keyof LLMRegistry>(
		name: string,
		config: LLMRegistry[K]["config"],
	): Promise<LLMRegistry[K]["llm"]> {
		if (this.llms.has(name)) {
			throw new Error(`LLM with name "${name}" already exists`);
		}

		let llm: LLMRegistry[K]["llm"];

		switch (config.type) {
			case "wllama":
				llm = new WllamaLLM(
					(config as WllamaConfig).url,
				) as LLMRegistry[K]["llm"];
				break;
			case "webllm":
				llm = new WebLLMLLM(
					(config as WebLLMConfig).url,
				) as LLMRegistry[K]["llm"];
				break;
			case "openai":
				llm = new OpenAILLM(
					(config as OpenAIConfig).apiKey,
					(config as OpenAIConfig).baseURL,
				) as LLMRegistry[K]["llm"];
				break;
			case "ollama":
				llm = new LocalOpenAICompatLLM(
					(config as OllamaConfig).baseURL,
				) as LLMRegistry[K]["llm"];
				break;
			case "lmstudio":
				llm = new LocalOpenAICompatLLM(
					(config as LMStudioConfig).baseURL,
				) as LLMRegistry[K]["llm"];
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

	async modelsFor(name: string) {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.models();
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

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.unload(modelId);
	}

	async deleteModelFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.delete(modelId);
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

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		if (!llm.serve)
			throw new Error(`LLM "${name}" does not support serve operation`);
		// Unload models from other services before serving this one
		await this.unloadOtherServices(name);
		const result = await llm.serve(model, onProgress);
		const provider: ServiceProvider =
			name === DEFAULT_SERVICES.WEBLLM
				? "webllm"
				: name === DEFAULT_SERVICES.WLLAMA
					? "wllama"
					: "openai";
		await this.setCurrentModel(model, provider);
		return result;
	}

	async initialize(): Promise<void> {
		await sharedStorageService.initialize();

		// Full mode: Initialize all local services including heavy ones
		await this.ensureAllServices();

		await this.loadCurrentModelFromStorage();
		this.setupStorageListener();
	}

	// Current model tracking with persistence
	async getCurrentModel(): Promise<CurrentModelInfo | null> {
		// Try to load from storage if not in memory and not already attempted
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

	private findServiceNameForProvider(provider: ServiceProvider): string | null {
		const services = this.list();

		if (provider === "wllama" && services.includes(DEFAULT_SERVICES.WLLAMA)) {
			return DEFAULT_SERVICES.WLLAMA;
		}
		if (provider === "webllm" && services.includes(DEFAULT_SERVICES.WEBLLM)) {
			return DEFAULT_SERVICES.WEBLLM;
		}
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

	async clearCurrentModel(): Promise<void> {
		this.currentModel = null;
		// Reset the flag to allow reloading from storage if needed
		this.storageLoadAttempted = false;
		// Clear from storage as well
		await this.saveCurrentModelToStorage();

		// Notify listeners of the change
		this.notifyCurrentModelChange();
	}

	private async saveCurrentModelToStorage(): Promise<void> {
		try {
			if (!sharedStorageService.isAvailable()) {
				return;
			}

			await sharedStorageService.set(
				CURRENT_MODEL_KEY,
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
				CURRENT_MODEL_KEY,
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
			CURRENT_MODEL_KEY,
			async (event) => {
				if (event.newValue !== this.currentModel) {
					const newModel = event.newValue;

					if (newModel && newModel.provider && newModel.serviceName) {
						if (!this.has(newModel.serviceName)) {
							await this.refreshLocalServices();
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

	private async refreshLocalServices(): Promise<void> {
		try {
			await this.restoreLocalServices();
		} catch (error) {
			logWarn("Failed to refresh local services:", error);
		}
	}

	async refreshServiceConfigurations(): Promise<void> {
		await this.refreshLocalServices();
	}

	async ensureServiceForProvider(
		provider: ServiceProvider,
	): Promise<string | null> {
		let serviceName = this.findServiceNameForProvider(provider);

		if (!serviceName) {
			try {
				await this.refreshLocalServices();
				serviceName = this.findServiceNameForProvider(provider);
			} catch (error) {
				logWarn(`Failed to refresh services for provider ${provider}:`, error);
			}
		}

		return serviceName;
	}

	// Cleanup method
	destroy(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
			this.storageUnsubscribe = null;
		}
		this.clear();
	}


	async ensureAllServices(): Promise<void> {
		// Full mode: Create all services including heavy ones
		if (!this.has(DEFAULT_SERVICES.WLLAMA)) {
			try {
				await this.create(DEFAULT_SERVICES.WLLAMA, { type: "wllama" });
			} catch (error) {
				logWarn("Failed to create Wllama service:", error);
			}
		}
		if (!this.has(DEFAULT_SERVICES.WEBLLM)) {
			try {
				await this.create(DEFAULT_SERVICES.WEBLLM, { type: "webllm" });
			} catch (error) {
				logWarn("Failed to create WebLLM service:", error);
			}
		}

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

	isReady(): boolean {
		return (
			this.isReadyByName(DEFAULT_SERVICES.WLLAMA) ||
			this.isReadyByName(DEFAULT_SERVICES.WEBLLM) ||
			this.isReadyByName(DEFAULT_SERVICES.OPENAI)
		);
	}

	async models() {
		await this.ensureAllServices();
		const results: ModelInfo[] = [];
		try {
			const w = await this.modelsFor(DEFAULT_SERVICES.WLLAMA);
			results.push(...w.data);
		} catch (e) {
			logWarn("models(): Wllama models error", e);
		}
		try {
			const w = await this.modelsFor(DEFAULT_SERVICES.WEBLLM);
			w.data.forEach((m) => {
				if (!results.find((r) => r.id === m.id)) results.push(m);
			});
		} catch (e) {
			logWarn("models(): WebLLM models error", e);
		}
		if (this.has(DEFAULT_SERVICES.OPENAI)) {
			try {
				const w = await this.modelsFor(DEFAULT_SERVICES.OPENAI);
				w.data.forEach((m) => {
					if (!results.find((r) => r.id === m.id)) results.push(m);
				});
			} catch (e) {
				logWarn("models(): OpenAI models error", e);
			}
		}
		return { object: "list", data: results } as const;
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

	async unload(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.unloadFor(this.currentModel.serviceName, modelId);
	}

	async deleteModel(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.deleteModelFor(this.currentModel.serviceName, modelId);
	}

	getInfo() {
		const ready = this.isReady();
		return {
			name: this.currentModel?.serviceName || "unknown",
			type: this.currentModel?.provider || "wllama",
			ready,
		};
	}

	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		await this.ensureAllServices();
		if (this.has(DEFAULT_SERVICES.OPENAI)) {
			try {
				const openai = await this.modelsFor(DEFAULT_SERVICES.OPENAI);
				const found = openai.data.find((m) => m.id === model);
				if (found) {
					await this.unloadOtherServices(DEFAULT_SERVICES.OPENAI);
					await this.setCurrentModel(model, "openai");
					return found;
				}
			} catch (e) {
				// ignore openai errors here
			}
		}
		try {
			const webllm = await this.modelsFor(DEFAULT_SERVICES.WEBLLM);
			if (webllm?.data?.some((m) => m.id === model)) {
				return this.serveFor(DEFAULT_SERVICES.WEBLLM, model, onProgress);
			}
		} catch {
			// ignore
		}
		return this.serveFor(DEFAULT_SERVICES.WLLAMA, model, onProgress);
	}

	private async unloadOtherServices(exceptName: string): Promise<void> {
		for (const [name] of this.llms) {
			if (name === exceptName) continue;
			if (name === DEFAULT_SERVICES.OPENAI) continue;
			try {
				const models = await this.modelsFor(name);
				for (const m of models.data) {
					if (m.loaded) {
						try {
							await this.unloadFor(name, m.id);
						} catch (e) {
							logWarn(
								`Failed to unload model ${m.id} from service ${name}:`,
								e,
							);
						}
					}
				}
			} catch (e) {
				logWarn(`Failed to fetch models for service ${name}:`, e);
			}
		}
	}
}

// Export class for ServiceManager to instantiate
// No singleton instance - ServiceManager will create instances
