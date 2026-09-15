import { logDebug, logWarn, logInfo } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { LOCAL_SERVER_LLM_CONFIG_KEYS } from "@/config/local-server-llm";
import type {
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type { BaseLLM, ModelInfo } from "./interfaces/base-llm";
import type {
	CurrentModelInfo,
	CurrentModelsByCategory,
	ServeOptions,
	ServiceProvider,
} from "./interfaces/llm-service.interface";
import {
	MEDIA_CATEGORIES,
	isWorkspaceMode,
	type ModelCategory,
	type WorkspaceMode,
} from "./interfaces/model-category";
import { primaryCategoryOf } from "./registry/media-model-registry";
import type { ToolCapabilityInfo } from "./interfaces/tool-capability";
import { NO_TOOL_SUPPORT } from "./interfaces/tool-capability";
import {
	CURRENT_MODEL_KEY,
	CURRENT_MODELS_BY_CATEGORY_KEY,
	DEFAULT_ON_DEMAND_SERVICE_CONFIGS,
	SERVICE_TO_PROVIDER,
	type DefaultOnDemandServiceName,
} from "./constants";
import type { LLMRegistry } from "./interfaces/service";
import { PROVIDER_REGISTRY, isKnownProvider } from "./provider-registry";

type MediaMethod =
	| "audioSpeech"
	| "audioSpeechStream"
	| "audioTranscriptions"
	| "audioTranscriptionsStream"
	| "imagesGenerations"
	| "imagesTools"
	| "textTools";

const MEDIA_METHOD_LABELS: Record<MediaMethod, string> = {
	audioSpeech: "text-to-speech",
	audioSpeechStream: "streaming text-to-speech",
	audioTranscriptions: "speech-to-text",
	audioTranscriptionsStream: "streaming speech-to-text",
	imagesGenerations: "image generation",
	imagesTools: "image tools",
	textTools: "text tools",
};

export class UnsupportedModelOperationError extends Error {
	constructor(serviceName: string, operation: string) {
		super(`Provider "${serviceName}" does not support ${operation}`);
		this.name = "UnsupportedModelOperationError";
	}
}

export function sameCurrentModel(
	a: CurrentModelInfo | null | undefined,
	b: CurrentModelInfo | null | undefined,
): boolean {
	if (!a || !b) return !a && !b;
	return (
		a.modelId === b.modelId &&
		a.provider === b.provider &&
		a.serviceName === b.serviceName
	);
}

export function sanitizeCategorySelections(
	value: unknown,
): CurrentModelsByCategory {
	if (!value || typeof value !== "object") {
		return {};
	}
	const source = value as CurrentModelsByCategory;
	const result: CurrentModelsByCategory = {};
	for (const category of MEDIA_CATEGORIES) {
		const entry = source[category];
		if (entry?.modelId && entry.serviceName && entry.provider) {
			result[category] = entry;
		}
	}
	return result;
}

export abstract class LLMServiceCore {
	protected llms = new Map<string, BaseLLM>();
	protected currentModel: CurrentModelInfo | null = null;
	protected currentModelsByCategory: CurrentModelsByCategory = {};
	private storageUnsubscribe: (() => void) | null = null;
	private storageLoadAttempted = false;

	protected abstract create<K extends keyof LLMRegistry>(
		name: string,
		config: LLMRegistry[K]["config"],
	): Promise<LLMRegistry[K]["llm"]>;

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

	private currentModelsListeners = new Set<
		(category: WorkspaceMode, model: CurrentModelInfo | null) => void
	>();

	// Notify all listeners of current model change
	protected notifyCurrentModelChange(): void {
		this.currentModelListeners.forEach((listener) =>
			listener(this.currentModel),
		);
		this.notifyCategoryChange("chat", this.currentModel);
	}

	/** Fires for every category, chat included. */
	onCurrentModelsChange(
		listener: (category: WorkspaceMode, model: CurrentModelInfo | null) => void,
	): () => void {
		this.currentModelsListeners.add(listener);
		return () => this.currentModelsListeners.delete(listener);
	}

	private notifyCategoryChange(
		category: WorkspaceMode,
		model: CurrentModelInfo | null,
	): void {
		this.currentModelsListeners.forEach((listener) =>
			listener(category, model),
		);
	}

	async initialize(): Promise<void> {
		await this.loadCurrentModelFromStorage();
		await this.loadCurrentModelsByCategoryFromStorage();
		this.setupStorageListener();
		await this.ensureAllServices();
		// Note: ensureCurrentModelService() is not needed here since ensureAllServices() already handles it
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
		provider: ServiceProvider,
		modelId: string,
		serviceName: string,
	): Promise<void> {
		// All data must be provided independently - no detection or derivation
		if (!serviceName) {
			throw new Error(
				`Service name is required. Cannot detect service from provider. Available services: ${this.list().join(", ")}`,
			);
		}

		// Check if model is actually changing to avoid unnecessary storage writes
		const isChanging =
			!this.currentModel ||
			this.currentModel.modelId !== modelId ||
			this.currentModel.provider !== provider ||
			this.currentModel.serviceName !== serviceName;

		if (!isChanging) {
			// Model hasn't changed, skip storage write to avoid loops
			return;
		}

		await this.ensureCurrentModelService();

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

	async getCurrentModelFor(
		category: WorkspaceMode,
	): Promise<CurrentModelInfo | null> {
		if (category === "chat") {
			return this.getCurrentModel();
		}
		return this.currentModelsByCategory[category] ?? null;
	}

	async getCurrentModels(): Promise<CurrentModelsByCategory> {
		return { ...this.currentModelsByCategory };
	}

	async setCurrentModelFor(
		category: WorkspaceMode,
		provider: ServiceProvider,
		modelId: string,
		serviceName: string,
	): Promise<void> {
		if (category === "chat") {
			return this.setCurrentModel(provider, modelId, serviceName);
		}
		if (!serviceName) {
			throw new Error("Service name is required");
		}
		const next: CurrentModelInfo = { modelId, provider, serviceName };
		if (sameCurrentModel(this.currentModelsByCategory[category], next)) {
			return;
		}
		this.currentModelsByCategory = {
			...this.currentModelsByCategory,
			[category]: next,
		};
		await this.saveConfig(
			CURRENT_MODELS_BY_CATEGORY_KEY,
			this.currentModelsByCategory,
		);
		this.notifyCategoryChange(category, next);
	}

	async clearCurrentModelFor(category: WorkspaceMode): Promise<void> {
		if (category === "chat") {
			return this.clearCurrentModel();
		}
		if (!this.currentModelsByCategory[category]) {
			return;
		}
		const { [category]: _removed, ...rest } = this.currentModelsByCategory;
		this.currentModelsByCategory = rest;
		await this.saveConfig(
			CURRENT_MODELS_BY_CATEGORY_KEY,
			this.currentModelsByCategory,
		);
		this.notifyCategoryChange(category, null);
	}

	async clearCurrentModelsForProvider(
		provider: ServiceProvider,
	): Promise<void> {
		for (const category of MEDIA_CATEGORIES) {
			if (this.currentModelsByCategory[category]?.provider === provider) {
				await this.clearCurrentModelFor(category);
			}
		}
		if (this.currentModel?.provider === provider) {
			await this.clearCurrentModel();
		}
	}

	list(): string[] {
		return Array.from(this.llms.keys());
	}

	getInfoFor(name: string) {
		const llm = this.llms.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.getInfo();
	}

	has(name: string): boolean {
		return this.llms.has(name);
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

	isReadyByName(name: string): boolean {
		const llm = this.llms.get(name);
		return llm ? llm.isReady() : false;
	}

	// Cleanup method
	destroy(): void {
		if (this.storageUnsubscribe) {
			this.storageUnsubscribe();
			this.storageUnsubscribe = null;
		}
		this.clear();
	}

	remove(name: string): boolean {
		const llm = this.llms.get(name);
		if (llm && "destroy" in llm) {
			const destroyFn = (llm as { destroy?: () => void }).destroy;
			if (typeof destroyFn === "function") destroyFn.call(llm);
		}
		return this.llms.delete(name);
	}

	protected async ensureCurrentModelService(): Promise<void> {
		const currentModel = await this.getCurrentModel();
		if (currentModel && this.ensureAllServices) {
			try {
				await this.ensureAllServices();
			} catch (error) {
				logWarn(
					`Failed to auto-create service ${currentModel.serviceName}:`,
					error,
				);
			}
		}
	}

	protected async ensureOnDemandService(
		name: string,
		failureContext = "create service on-demand",
	): Promise<boolean> {
		if (this.has(name)) {
			return true;
		}

		const serviceName = name as DefaultOnDemandServiceName;
		const config = DEFAULT_ON_DEMAND_SERVICE_CONFIGS[serviceName];
		if (!config) {
			return false;
		}

		try {
			await this.create(serviceName, config);
			return true;
		} catch (error) {
			logWarn(`Failed to ${failureContext}: ${name}`, error);
			return false;
		}
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
		await this.saveConfig(CURRENT_MODEL_KEY, this.currentModel);
	}

	/**
	 * Persist a selection to the configurations table (the source of truth) and
	 * broadcast it through shared storage so every context updates.
	 */
	private async saveConfig(key: string, value: unknown): Promise<void> {
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const data = value as Record<string, unknown>;
				const existing = await db
					.select()
					.from(schema.configurations)
					.where(eq(schema.configurations.key, key))
					.limit(1);

				if (existing.length > 0) {
					await db
						.update(schema.configurations)
						.set({ data, updatedAt: new Date() })
						.where(eq(schema.configurations.key, key));
				} else {
					await db.insert(schema.configurations).values({
						key,
						data,
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
			});

			// Store in SharedStorage (IndexedDB) and broadcast to other contexts
			if (sharedStorageService.isAvailable()) {
				await sharedStorageService.set(key, value);
			}
		} catch (error) {
			logWarn(`Failed to save ${key} to storage:`, error);
		}
	}

	private async loadCurrentModelsByCategoryFromStorage(): Promise<void> {
		try {
			const rows = await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.select()
					.from(schema.configurations)
					.where(eq(schema.configurations.key, CURRENT_MODELS_BY_CATEGORY_KEY))
					.limit(1),
			);
			this.currentModelsByCategory = sanitizeCategorySelections(rows[0]?.data);
		} catch (error) {
			logWarn("Failed to load per-category models from storage:", error);
		}
	}

	private async loadCurrentModelFromStorage(): Promise<void> {
		try {
			this.storageLoadAttempted = true;

			// Load from database (source of truth)
			const rows = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					return db
						.select()
						.from(schema.configurations)
						.where(eq(schema.configurations.key, CURRENT_MODEL_KEY))
						.limit(1);
				},
			);

			if (rows.length > 0 && rows[0].data) {
				// Use stored data independently - no detection or derivation
				// storedModel should contain: provider, serviceName, modelId
				this.currentModel = rows[0].data as unknown as CurrentModelInfo;
			}
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
				logDebug(`Storage event for ${CURRENT_MODEL_KEY}:`, event);

				// Deep comparison to check if model actually changed
				const isSame =
					event.newValue &&
					this.currentModel &&
					event.newValue.modelId === this.currentModel.modelId &&
					event.newValue.provider === this.currentModel.provider &&
					event.newValue.serviceName === this.currentModel.serviceName;

				// Update in-memory state only if changed externally
				if (!isSame) {
					this.currentModel = event.newValue;
					this.notifyCurrentModelChange();
					// Note: Don't call ensureCurrentModelService() here to avoid infinite loops
					// The service initialization is handled by ensureAllServices() during initialization
				}
			},
		);
		unsubscribeFunctions.push(modelUnsubscribe);

		const categoriesUnsubscribe =
			sharedStorageService.subscribe<CurrentModelsByCategory>(
				CURRENT_MODELS_BY_CATEGORY_KEY,
				(event) => {
					const next = sanitizeCategorySelections(event.newValue);
					const previous = this.currentModelsByCategory;
					this.currentModelsByCategory = next;
					for (const category of MEDIA_CATEGORIES) {
						if (!sameCurrentModel(previous[category], next[category])) {
							this.notifyCategoryChange(category, next[category] ?? null);
						}
					}
				},
			);
		unsubscribeFunctions.push(categoriesUnsubscribe);

		this.storageUnsubscribe = () => {
			unsubscribeFunctions.forEach((fn) => fn());
		};
	}

	getInfo() {
		const ready = this.isReady();
		return {
			name: this.currentModel?.serviceName || "unknown",
			type: this.currentModel?.provider || "unknown",
			ready,
		};
	}

	// Shared method to load local service configurations from database
	protected async loadLocalServiceConfigs(): Promise<Record<
		string,
		{ type: string; baseURL: string; modelId?: string }
	> | null> {
		try {
			// Load configurations from database
			const configs: Record<
				string,
				{ type: string; baseURL: string; modelId?: string }
			> = {};

			// Check for LMStudio config
			try {
				const lmstudioRows = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(
									schema.configurations.key,
									LOCAL_SERVER_LLM_CONFIG_KEYS.LLM_STUDIO,
								),
							);
					},
				);

				const lmstudioConfig = lmstudioRows[0];
				if (lmstudioConfig?.data?.baseUrl) {
					configs.lmstudio = {
						type: "lmstudio",
						baseURL: `${lmstudioConfig.data.baseUrl}`,
						modelId: lmstudioConfig.data.modelId
							? `${lmstudioConfig.data.modelId}`
							: undefined,
					};
					logInfo(
						"🔍 Loaded LMStudio config from database:",
						lmstudioConfig.data.baseUrl,
					);
				}
			} catch (error) {
				logWarn("Failed to load LMStudio config from database:", error);
			}

			// Check for Ollama config
			try {
				const ollamaRows = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(
									schema.configurations.key,
									LOCAL_SERVER_LLM_CONFIG_KEYS.OLLAMA,
								),
							);
					},
				);

				const ollamaConfig = ollamaRows[0];
				if (ollamaConfig?.data?.baseUrl) {
					configs.ollama = {
						type: "ollama",
						baseURL: `${ollamaConfig.data.baseUrl}`,
						modelId: ollamaConfig.data.modelId
							? `${ollamaConfig.data.modelId}`
							: undefined,
					};
					logInfo(
						"🔍 Loaded Ollama config from database:",
						ollamaConfig.data.baseUrl,
					);
				}
			} catch (error) {
				logWarn("Failed to load Ollama config from database:", error);
			}

			return Object.keys(configs).length > 0 ? configs : null;
		} catch (error) {
			logWarn("Failed to load local service configs from database:", error);
			return null;
		}
	}

	async getMaxModelTokens(model?: string): Promise<number> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		return this.getMaxModelTokensFor(this.currentModel.serviceName, model);
	}

	async getMaxModelTokensFor(name: string, model?: string): Promise<number> {
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(
				`Service "${name}" not found. Service must be registered first.`,
			);
		}

		return await llm.getMaxModelTokens(model || this.currentModel?.modelId);
	}

	async getMaxResponseTokens(model?: string): Promise<number> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		return this.getMaxResponseTokensFor(this.currentModel.serviceName, model);
	}

	async getMaxResponseTokensFor(name: string, model?: string): Promise<number> {
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(
				`Service "${name}" not found. Service must be registered first.`,
			);
		}

		return await llm.getMaxResponseTokens(model || this.currentModel?.modelId);
	}

	async getToolCapabilities(model?: string): Promise<ToolCapabilityInfo> {
		if (!this.currentModel) {
			return NO_TOOL_SUPPORT;
		}

		return this.getToolCapabilitiesFor(this.currentModel.serviceName, model);
	}

	async getToolCapabilitiesFor(
		name: string,
		model?: string,
	): Promise<ToolCapabilityInfo> {
		const llm = await this.get(name);
		if (!llm) {
			return NO_TOOL_SUPPORT;
		}

		return await llm.getToolCapabilities(model || this.currentModel?.modelId);
	}

	async supportsTools(model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilities(model);
		return capability.supported;
	}

	async supportsToolsFor(name: string, model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilitiesFor(name, model);
		return capability.supported;
	}

	/**
	 * Which selection a serve of `model` on `name` belongs to. A speech model
	 * must never land in the chat slot: agents, cron jobs and knowledge
	 * extraction all run on the chat model.
	 */
	protected resolveServeCategory(
		name: string,
		model: string,
		options?: ServeOptions,
		info?: Pick<ModelInfo, "categories">,
	): WorkspaceMode | null {
		if (options?.category) {
			return options.category;
		}
		const category = primaryCategoryOf(name, model, info);
		return isWorkspaceMode(category) ? category : null;
	}

	/** Record a successful serve as the selection for its category. */
	protected async recordServedModel(
		name: string,
		model: string,
		options?: ServeOptions,
		info?: Pick<ModelInfo, "categories">,
	): Promise<void> {
		if (options?.select === false) {
			return;
		}
		// Unknown until the runner describes the model; the serve that loads it
		// records the selection with the categories it reports.
		const category = this.resolveServeCategory(name, model, options, info);
		if (!category) {
			return;
		}
		const provider =
			SERVICE_TO_PROVIDER[name] ??
			(isKnownProvider(name) ? name : this.currentModel?.provider);
		if (!provider) {
			throw new Error(`Cannot determine provider for service "${name}"`);
		}
		await this.setCurrentModelFor(category, provider, model, name);
	}

	supportsCategoryFor(name: string, category: ModelCategory): boolean {
		const provider = SERVICE_TO_PROVIDER[name] ?? name;
		return isKnownProvider(provider)
			? PROVIDER_REGISTRY[provider].categories.includes(category)
			: category === "chat";
	}

	/**
	 * Lease a model for one operation. The main service overrides this to keep
	 * a single local model in memory; in the UI proxy the local runners live in
	 * the offscreen document, which takes the lease itself.
	 */
	protected async leaseModel(
		_serviceName: string,
		_modelId: string,
	): Promise<() => void> {
		return () => undefined;
	}

	private async requireMediaMethod<M extends MediaMethod>(
		name: string,
		method: M,
	): Promise<BaseLLM & Required<Pick<BaseLLM, M>>> {
		await this.ensureOnDemandService(name);
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(`LLM "${name}" not found`);
		}
		if (typeof llm[method] !== "function") {
			throw new UnsupportedModelOperationError(
				name,
				MEDIA_METHOD_LABELS[method],
			);
		}
		return llm as BaseLLM & Required<Pick<BaseLLM, M>>;
	}

	private async withLease<T>(
		name: string,
		model: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const release = await this.leaseModel(name, model);
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private async *streamWithLease<T>(
		name: string,
		model: string,
		open: () => AsyncIterableIterator<T>,
	): AsyncIterableIterator<T> {
		const release = await this.leaseModel(name, model);
		try {
			yield* open();
		} finally {
			release();
		}
	}

	async audioSpeechFor(
		name: string,
		request: SpeechCreateParams,
	): Promise<SpeechResponse> {
		const llm = await this.requireMediaMethod(name, "audioSpeech");
		return this.withLease(name, request.model, () => llm.audioSpeech(request));
	}

	async *audioSpeechStreamFor(
		name: string,
		request: SpeechCreateParams,
	): AsyncIterableIterator<SpeechStreamEvent> {
		const llm = await this.requireMediaMethod(name, "audioSpeechStream");
		yield* this.streamWithLease(name, request.model, () =>
			llm.audioSpeechStream(request),
		);
	}

	async audioTranscriptionsFor(
		name: string,
		request: TranscriptionCreateParams,
	): Promise<Transcription> {
		const llm = await this.requireMediaMethod(name, "audioTranscriptions");
		return this.withLease(name, request.model, () =>
			llm.audioTranscriptions(request),
		);
	}

	async *audioTranscriptionsStreamFor(
		name: string,
		request: TranscriptionCreateParams,
	): AsyncIterableIterator<TranscriptionStreamEvent> {
		const llm = await this.requireMediaMethod(
			name,
			"audioTranscriptionsStream",
		);
		yield* this.streamWithLease(name, request.model, () =>
			llm.audioTranscriptionsStream(request),
		);
	}

	async *imagesGenerationsFor(
		name: string,
		request: ImageGenerateParams,
	): AsyncIterableIterator<ImageGenerationStreamEvent> {
		const llm = await this.requireMediaMethod(name, "imagesGenerations");
		yield* this.streamWithLease(name, request.model, () =>
			llm.imagesGenerations(request),
		);
	}

	async imagesToolsFor(
		name: string,
		request: ImageToolParams,
	): Promise<ImageToolResponse> {
		const llm = await this.requireMediaMethod(name, "imagesTools");
		return this.withLease(name, request.model, () => llm.imagesTools(request));
	}

	async textToolsFor(
		name: string,
		request: TextToolParams,
	): Promise<TextToolResponse> {
		const llm = await this.requireMediaMethod(name, "textTools");
		return this.withLease(name, request.model, () => llm.textTools(request));
	}

	// Abstract methods that must be implemented by concrete classes
	abstract get(name: string): Promise<BaseLLM | undefined>;
	abstract isReady(): boolean;
	abstract ensureAllServices(): Promise<void>;
}
