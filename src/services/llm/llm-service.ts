import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { WllamaLLM } from "./implementations/wllama-llm";
import { WebLLMLLM } from "./implementations/webllm-llm";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatLLM } from "./implementations/local-openai-llm";
import { logWarn } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";

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

export class LLMService {
	private llms = new Map<string, BaseLLM>();
	private currentModel: CurrentModelInfo | null = null;
	private storageUnsubscribe: (() => void) | null = null;
	private storageLoadAttempted = false; // Prevent repeated storage access attempts
	private static readonly CURRENT_MODEL_KEY = "llm-current-model";

	// Shared config keys - used by both UI and service
	private static readonly CONFIG_KEYS = {
		LMSTUDIO: "lmstudio_config",
		OLLAMA: "ollama_config",
	} as const;

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

	// CRITICAL: Ensure service is available in offscreen when user configures it
	async ensureServiceInOffscreen(
		serviceName: string,
		config: { type: string; baseURL?: string },
	): Promise<void> {
		// Send message to offscreen to create/update the service
		try {
			logWarn(`🔍 DEBUG: Attempting to send service config to offscreen:`, {
				serviceName,
				config,
				chromeExists: typeof chrome !== "undefined",
				runtimeExists: typeof chrome !== "undefined" && !!chrome.runtime,
			});

			if (typeof chrome !== "undefined" && chrome.runtime) {
				const message = {
					type: "ENSURE_LLM_SERVICE",
					serviceName,
					config,
				};
				logWarn(`🔍 DEBUG: Sending message:`, message);
				await chrome.runtime.sendMessage(message);
				logWarn(
					`📤 Successfully sent service config to offscreen: ${serviceName}`,
				);
			} else {
				logWarn(
					`❌ Cannot send to offscreen: chrome or chrome.runtime not available`,
				);
			}
		} catch (error) {
			logWarn(`❌ Failed to sync service ${serviceName} to offscreen:`, error);
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

	// Async getter that ensures readiness
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

	// Named operations (ensure-ready access)
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

	// ---------- Default services (wllama + webllm) ----------
	async initialize(): Promise<void> {
		// Initialize shared storage service first
		logWarn("🔄 LLMService: Initializing SharedStorageService...");
		await sharedStorageService.initialize();
		logWarn("✅ LLMService: SharedStorageService initialized");

		// Give storage a moment to be fully ready
		await new Promise((resolve) => setTimeout(resolve, 100));

		await this.ensureAllServices();

		// Load current model selection from storage and subscribe to changes
		logWarn("🔄 LLMService: Loading current model from storage...");
		await this.loadCurrentModelFromStorage();
		logWarn("🔄 LLMService: Setting up storage listener...");
		this.setupStorageListener();
		logWarn("✅ LLMService: Storage setup complete");
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
		logWarn(`🔧 Setting current model: ${modelId} (${provider})`);

		// Find the actual service name for this provider type
		const serviceName = this.findServiceNameForProvider(provider);
		if (!serviceName) {
			throw new Error(`No service found for provider: ${provider}. Available services: ${this.list().join(', ')}`);
		}

		this.currentModel = {
			modelId,
			provider,
			serviceName,
		};

		// Reset the flag since we now have a model
		this.storageLoadAttempted = true;

		// Persist to storage so offscreen document can access it
		try {
			await this.saveCurrentModelToStorage();
			logWarn(`✅ Successfully set and saved current model: ${modelId}`);
		} catch (error) {
			logWarn(`❌ Failed to save current model to storage:`, error);
			// Continue anyway - the model is set in memory
		}

		// Notify listeners of the change
		this.notifyCurrentModelChange();
	}

	/**
	 * Find the actual service name for a given provider type
	 * This searches through existing services to find one that matches the provider
	 */
	private findServiceNameForProvider(provider: ServiceProvider): string | null {
		const services = this.list();

		// For default services, try to find them first
		if (provider === "wllama" && services.includes(DEFAULT_SERVICES.WLLAMA)) {
			return DEFAULT_SERVICES.WLLAMA;
		}
		if (provider === "webllm" && services.includes(DEFAULT_SERVICES.WEBLLM)) {
			return DEFAULT_SERVICES.WEBLLM;
		}
		if (provider === "openai" && services.includes(DEFAULT_SERVICES.OPENAI)) {
			return DEFAULT_SERVICES.OPENAI;
		}

		// For external services (lmstudio, ollama), find any service that matches the type
		// by checking the service info
		for (const serviceName of services) {
			try {
				const serviceInfo = this.getInfoFor(serviceName);
				if (serviceInfo.type === provider) {
					return serviceName;
				}
			} catch (error) {
				// Skip services that can't provide info
				continue;
			}
		}

		// Fallback: look for services with names containing the provider
		const matchingService = services.find(name =>
			name.toLowerCase().includes(provider.toLowerCase())
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

	// Storage persistence methods using SharedStorageService
	private async saveCurrentModelToStorage(): Promise<void> {
		try {
			if (!sharedStorageService.isAvailable()) {
				return;
			}

			await sharedStorageService.set(
				LLMService.CURRENT_MODEL_KEY,
				this.currentModel,
			);
		} catch (error) {
			logWarn("❌ Failed to save current model to storage:", error);
		}
	}

	private async loadCurrentModelFromStorage(): Promise<void> {
		try {
			// Mark that we've attempted to load from storage
			this.storageLoadAttempted = true;

			// Check if SharedStorageService is available
			if (!sharedStorageService.isAvailable()) {
				return;
			}

			const storedModel = await sharedStorageService.get<CurrentModelInfo>(
				LLMService.CURRENT_MODEL_KEY,
			);
			if (storedModel) {
				// Check if the stored model has a valid modelId (not empty)
				if (storedModel.modelId && storedModel.modelId.trim() !== "") {
					// Validate that the stored service name actually exists
					if (storedModel.serviceName && this.has(storedModel.serviceName)) {
						this.currentModel = storedModel;
						logWarn(
							`✅ Restored model from storage: ${this.currentModel?.modelId} (${this.currentModel?.provider})`,
						);
					} else {
						// Service doesn't exist, try to find the correct one
						logWarn(
							`⚠️ Stored service '${storedModel.serviceName}' not found, attempting to resolve...`,
						);
						const correctServiceName = this.findServiceNameForProvider(storedModel.provider);
						if (correctServiceName) {
							this.currentModel = {
								...storedModel,
								serviceName: correctServiceName,
							};
							// Save the corrected model back to storage
							await this.saveCurrentModelToStorage();
							logWarn(
								`✅ Corrected service name from '${storedModel.serviceName}' to '${correctServiceName}' for ${storedModel.modelId}`,
							);
						} else {
							logWarn(
								`❌ No available service found for provider '${storedModel.provider}'. Available services: ${this.list().join(', ')}`,
							);
							this.currentModel = null; // Clear invalid model
						}
					}
				} else {
					this.currentModel = storedModel; // Keep provider info but mark as not loaded
				}
			}

			// Always notify listeners after attempting to load (even if null)
			this.notifyCurrentModelChange();
		} catch (error) {
			logWarn("❌ Failed to load current model from storage:", error);
		}
	}

	// Setup listener for storage changes from other contexts
	private setupStorageListener(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
		}

		this.storageUnsubscribe = sharedStorageService.subscribe<CurrentModelInfo>(
			LLMService.CURRENT_MODEL_KEY,
			(event) => {
				// Only update if the change came from another context
				if (event.newValue !== this.currentModel) {
					this.currentModel = event.newValue;
					// Only log significant changes or when debugging
					if (event.newValue?.modelId !== event.oldValue?.modelId) {
						logWarn(
							`🔄 Model changed: ${event.newValue?.modelId} (${event.newValue?.provider})`,
						);
					}
				}
			},
		);
	}

	// Cleanup method
	destroy(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
			this.storageUnsubscribe = null;
		}
		this.clear();
	}

	// Force save current model to storage (for debugging)
	async forceSaveCurrentModel(): Promise<void> {
		try {
			logWarn("🔧 Force saving current model to storage...");
			await this.saveCurrentModelToStorage();
			logWarn("✅ Force save completed");

			// Verify it was saved
			const saved = await sharedStorageService.get(
				LLMService.CURRENT_MODEL_KEY,
			);
			logWarn("🔍 Verification - saved model:", saved);
		} catch (error) {
			logWarn("❌ Force save failed:", error);
		}
	}

	// Debug method to investigate current storage state
	async debugCurrentModelStorage(): Promise<void> {
		try {
			logWarn("🔍 === DEBUG: Current Model Storage Investigation ===");

			// 1. Check SharedStorageService availability
			const isAvailable = sharedStorageService.isAvailable();
			logWarn(`📦 SharedStorageService available: ${isAvailable}`);

			// 2. Check chrome.storage availability
			logWarn(
				`🌐 Chrome storage available: ${!!globalThis.chrome?.storage?.local}`,
			);

			// 3. Check current model in memory
			logWarn(`🧠 Current model in memory:`, this.currentModel);

			// 4. Check current model in storage directly
			if (isAvailable) {
				const storedModel = await sharedStorageService.get(
					LLMService.CURRENT_MODEL_KEY,
				);
				logWarn(`💾 Current model in storage:`, storedModel);

				// 5. List all storage keys
				const allKeys = await sharedStorageService.getAllKeys();
				logWarn(`🔑 All storage keys:`, allKeys);

				// 6. Check if key exists with different format
				const allData = await chrome.storage.local.get();
				logWarn(`📋 All storage data:`, allData);
			}

			// 7. Check service states
			logWarn(`🔧 Available LLM services:`, this.list());
			logWarn(`✅ LLM service ready:`, this.isReady());

			logWarn("🔍 === END DEBUG ===");
		} catch (error) {
			logWarn("❌ Debug investigation failed:", error);
		}
	}

	// Debug method to test storage persistence
	async testStoragePersistence(): Promise<void> {
		try {
			logWarn("🧪 Testing storage persistence...");

			// Test 1: Basic storage availability
			const isAvailable = sharedStorageService.isAvailable();
			logWarn(`📦 Storage available: ${isAvailable}`);

			if (!isAvailable) {
				logWarn("❌ Cannot test persistence - storage not available");
				return;
			}

			// Test 2: Save a test model
			const testModel: CurrentModelInfo = {
				modelId: "test-model-123",
				provider: "wllama",
				serviceName: "wllama",
			};

			logWarn("💾 Saving test model...");
			await sharedStorageService.set("test-llm-model", testModel);
			logWarn("✅ Test model saved");

			// Test 3: Retrieve the test model
			logWarn("🔍 Retrieving test model...");
			const retrieved =
				await sharedStorageService.get<CurrentModelInfo>("test-llm-model");
			logWarn("📥 Retrieved test model:", retrieved);

			if (retrieved && retrieved.modelId === testModel.modelId) {
				logWarn("✅ Storage persistence test PASSED");
			} else {
				logWarn("❌ Storage persistence test FAILED");
			}

			// Test 4: Test current model key
			logWarn("🔍 Testing current model key...");
			const currentStored = await sharedStorageService.get<CurrentModelInfo>(
				LLMService.CURRENT_MODEL_KEY,
			);
			logWarn("📥 Current model in storage:", currentStored);

			// Cleanup test data
			await sharedStorageService.remove("test-llm-model");
			logWarn("🧹 Cleanup completed");
		} catch (error) {
			logWarn("❌ Storage persistence test failed with error:", error);
		}
	}

	// Ensure both services are available (OpenAI is created when user configures it)
	async ensureAllServices(): Promise<void> {
		// Ensure Wllama service
		if (!this.has(DEFAULT_SERVICES.WLLAMA)) {
			try {
				await this.create(DEFAULT_SERVICES.WLLAMA, { type: "wllama" });
			} catch (error) {
				logWarn("Failed to create Wllama service:", error);
			}
		}
		// Ensure WebLLM service
		if (!this.has(DEFAULT_SERVICES.WEBLLM)) {
			try {
				await this.create(DEFAULT_SERVICES.WEBLLM, { type: "webllm" });
			} catch (error) {
				logWarn("Failed to create WebLLM service:", error);
			}
		}

		// CRITICAL: Restore configured local services (LMStudio, Ollama) in offscreen context
		await this.restoreLocalServices();
	}

	// Restore configured local services from database
	private async restoreLocalServices(): Promise<void> {
		try {
			const { databaseService } = await import("@/services/database");
			const { schema } = await import("@/services/database/db");
			const { eq } = await import("drizzle-orm");

			// Check for LMStudio config
			if (!this.has("lmstudio")) {
				try {
					const lmstudioConfig = await databaseService.use(({ db }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(schema.configurations.key, LLMService.CONFIG_KEYS.LMSTUDIO),
							)
							.limit(1);
					});
					if (lmstudioConfig.length > 0) {
						const config = lmstudioConfig[0].data as {
							baseUrl: string;
							modelId: string;
						};
						logWarn("🔄 Restoring LMStudio service in offscreen:", config);
						await this.create("lmstudio", {
							type: "lmstudio",
							baseURL: config.baseUrl, // Note: database stores 'baseUrl', service expects 'baseURL'
						});
						logWarn("✅ LMStudio service restored in offscreen");
					}
				} catch (error) {
					logWarn("Failed to restore LMStudio service:", error);
				}
			}

			// Check for Ollama config
			if (!this.has("ollama")) {
				try {
					const ollamaConfig = await databaseService.use(({ db }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(schema.configurations.key, LLMService.CONFIG_KEYS.OLLAMA),
							)
							.limit(1);
					});
					if (ollamaConfig.length > 0) {
						const config = ollamaConfig[0].data as {
							baseUrl: string;
							modelId: string;
						};
						logWarn("🔄 Restoring Ollama service in offscreen:", config);
						await this.create("ollama", {
							type: "ollama",
							baseURL: config.baseUrl, // Note: database stores 'baseUrl', service expects 'baseURL'
						});
						logWarn("✅ Ollama service restored in offscreen");
					}
				} catch (error) {
					logWarn("Failed to restore Ollama service:", error);
				}
			}
		} catch (error) {
			logWarn("Failed to restore local services:", error);
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
		// Include OpenAI models if service is created
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

		// Debug: Log service selection only if there's an issue
		if (!this.has(name)) {
			logWarn(`❌ Service not found for chatCompletions:`, {
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
		// Determine provider by checking services; include OpenAI
		await this.ensureAllServices();
		// If OpenAI has this model, set current and return its model info
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
		// Next prefer WebLLM
		try {
			const webllm = await this.modelsFor(DEFAULT_SERVICES.WEBLLM);
			if (webllm?.data?.some((m) => m.id === model)) {
				return this.serveFor(DEFAULT_SERVICES.WEBLLM, model, onProgress);
			}
		} catch {
			// ignore
		}
		// Default to Wllama
		return this.serveFor(DEFAULT_SERVICES.WLLAMA, model, onProgress);
	}

	// Unload any loaded models from services other than the target
	private async unloadOtherServices(exceptName: string): Promise<void> {
		for (const [name] of this.llms) {
			if (name === exceptName) continue;
			if (name === DEFAULT_SERVICES.OPENAI) continue; // nothing to unload for OpenAI
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

export const llmService = new LLMService();
