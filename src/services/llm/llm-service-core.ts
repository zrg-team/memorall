import { logDebug, logWarn, logInfo } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { LOCAL_SERVER_LLM_CONFIG_KEYS } from "@/config/local-server-llm";
import type { BaseLLM } from "./interfaces/base-llm";
import type {
	CurrentModelInfo,
	ServiceProvider,
} from "./interfaces/llm-service.interface";
import { CURRENT_MODEL_KEY } from "./constants";

export abstract class LLMServiceCore {
	protected llms = new Map<string, BaseLLM>();
	protected currentModel: CurrentModelInfo | null = null;
	private storageUnsubscribe: (() => void) | null = null;
	private storageLoadAttempted = false;

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
	protected notifyCurrentModelChange(): void {
		this.currentModelListeners.forEach((listener) =>
			listener(this.currentModel),
		);
	}

	async initialize(): Promise<void> {
		await sharedStorageService.initialize();
		await this.loadCurrentModelFromStorage();
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
		modelId: string,
		provider: ServiceProvider,
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
			// Save to database (works in all contexts via serviceManager)
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Upsert into configurations table
				const existing = await db
					.select()
					.from(schema.configurations)
					.where(eq(schema.configurations.key, CURRENT_MODEL_KEY))
					.limit(1);

				if (existing.length > 0) {
					// Update existing
					await db
						.update(schema.configurations)
						.set({
							data: this.currentModel as unknown as Record<string, unknown>,
							updatedAt: new Date(),
						})
						.where(eq(schema.configurations.key, CURRENT_MODEL_KEY));
				} else {
					// Insert new
					await db.insert(schema.configurations).values({
						key: CURRENT_MODEL_KEY,
						data: this.currentModel as unknown as Record<string, unknown>,
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
			});

			// Store in SharedStorage (IndexedDB) and broadcast to other contexts
			if (sharedStorageService.isAvailable()) {
				await sharedStorageService.set(CURRENT_MODEL_KEY, this.currentModel);
			}
		} catch (error) {
			logWarn("Failed to save current model to storage:", error);
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

	// Abstract methods that must be implemented by concrete classes
	abstract get(name: string): Promise<BaseLLM | undefined>;
	abstract isReady(): boolean;
	abstract ensureAllServices(): Promise<void>;
}
