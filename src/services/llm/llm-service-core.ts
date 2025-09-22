import { logWarn } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";
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

		if (!this.has(serviceName)) {
			throw new Error(
				`Service "${serviceName}" not found. Available services: ${this.list().join(", ")}`,
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

	protected async createServiceForProvider(
		provider: ServiceProvider,
	): Promise<void> {
		// Default implementation - subclasses should override
		// This allows UI service to handle on-demand service creation
		throw new Error(
			`Cannot create service for provider: ${provider}. Override createServiceForProvider in subclass.`,
		);
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

			await sharedStorageService.set(CURRENT_MODEL_KEY, this.currentModel);
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

			const storedModel =
				await sharedStorageService.get<CurrentModelInfo>(CURRENT_MODEL_KEY);

			if (storedModel) {
				// Use stored data independently - no detection or derivation
				// storedModel should contain: provider, serviceName, modelId
				this.currentModel = storedModel;
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
					this.currentModel = event.newValue;
					this.notifyCurrentModelChange();
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

	// Abstract methods that must be implemented by concrete classes
	abstract get(name: string): Promise<BaseLLM | undefined>;
	abstract isReady(): boolean;
}
