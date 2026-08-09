import { sharedStorageService } from "@/services/shared-storage";
import { CURRENT_MODEL_KEY } from "../constants";
import type { ModelInfo, ModelsResponse } from "../interfaces/base-llm";
import type { CurrentModelInfo } from "../interfaces/llm-service.interface";

interface IframeRuntimeOptions {
	provider: string;
	ensureReady: () => Promise<void>;
	isReady: () => boolean;
	destroyIframe: () => void;
	fetchModels: () => Promise<ModelsResponse>;
	idleDestroyDelayMs?: number;
}

export class IframeRuntime {
	private modelsCache: ModelsResponse | null = null;
	private activeOperations = 0;
	private operationQueue: Promise<void> = Promise.resolve();
	private idleDestroyTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly provider: string;
	private readonly ensureReady: () => Promise<void>;
	private readonly isReady: () => boolean;
	private readonly destroyIframe: () => void;
	private readonly fetchModels: () => Promise<ModelsResponse>;
	private readonly idleDestroyDelayMs: number;

	constructor(options: IframeRuntimeOptions) {
		this.provider = options.provider;
		this.ensureReady = options.ensureReady;
		this.isReady = options.isReady;
		this.destroyIframe = options.destroyIframe;
		this.fetchModels = options.fetchModels;
		this.idleDestroyDelayMs = options.idleDestroyDelayMs ?? 30_000;
	}

	async cachedModelsWhenNotCurrent(): Promise<ModelsResponse | null> {
		const currentProvider = await this.getCurrentModelProvider();
		if (this.modelsCache && currentProvider !== this.provider) {
			return this.modelsCache;
		}
		return null;
	}

	async run<T>(
		operation: () => Promise<T>,
		options: { keepAlive?: boolean } = {},
	): Promise<T> {
		this.beginOperation();
		try {
			return await operation();
		} finally {
			await this.finishOperation(options);
		}
	}

	serialize<T>(operation: () => Promise<T>): Promise<T> {
		const queuedOperation = this.operationQueue.then(operation, operation);
		this.operationQueue = queuedOperation.then(
			() => undefined,
			() => undefined,
		);
		return queuedOperation;
	}

	async refreshModels(): Promise<ModelsResponse> {
		await this.ensureReady();
		const response = await this.fetchModels();
		response.data = response.data.map((model) => this.withProvider(model));
		this.modelsCache = response;
		return response;
	}

	async refreshModelsAfterMutation(): Promise<void> {
		this.modelsCache = null;
		await this.refreshModels().catch(() => {
			this.modelsCache = null;
		});
	}

	upsertCachedModel<T extends ModelInfo>(model: T): T {
		const cachedModel = this.withProvider(model);
		if (!this.modelsCache) {
			this.modelsCache = { object: "list", data: [cachedModel] };
			return cachedModel;
		}

		const existingIndex = this.modelsCache.data.findIndex(
			(item) => item.id === cachedModel.id,
		);
		if (existingIndex >= 0) {
			this.modelsCache.data[existingIndex] = cachedModel;
		} else {
			this.modelsCache.data.push(cachedModel);
		}
		return cachedModel;
	}

	withProvider<T extends ModelInfo>(model: T): T {
		return {
			...model,
			provider: this.provider,
		};
	}

	async shouldKeepAliveFor(model: ModelInfo): Promise<boolean> {
		return (
			(await this.isCurrentProvider()) ||
			model.loaded === true ||
			model.downloaded === true
		);
	}

	cancelIdleDestroy(): void {
		if (!this.idleDestroyTimer) return;
		clearTimeout(this.idleDestroyTimer);
		this.idleDestroyTimer = null;
	}

	beginOperation(): void {
		this.activeOperations++;
		this.cancelIdleDestroy();
	}

	async finishOperation(options: { keepAlive?: boolean } = {}): Promise<void> {
		this.activeOperations = Math.max(0, this.activeOperations - 1);
		if (this.activeOperations > 0 || options.keepAlive) return;
		if (await this.isCurrentProvider()) return;
		if (!this.modelsCache) return;
		if (this.hasLoadedOrDownloadedModel(this.modelsCache)) return;
		this.scheduleIdleDestroy();
	}

	private scheduleIdleDestroy(): void {
		if (this.idleDestroyTimer || !this.isReady()) return;
		this.idleDestroyTimer = setTimeout(() => {
			void (async () => {
				this.idleDestroyTimer = null;
				if (this.activeOperations > 0) return;
				if (await this.isCurrentProvider()) return;
				if (this.hasLoadedOrDownloadedModel(this.modelsCache)) return;
				this.destroyIframe();
			})();
		}, this.idleDestroyDelayMs);
	}

	private async getCurrentModelProvider(): Promise<string | null> {
		try {
			if (!sharedStorageService.isAvailable()) return null;
			const currentModel =
				await sharedStorageService.get<CurrentModelInfo>(CURRENT_MODEL_KEY);
			return currentModel?.serviceName ?? currentModel?.provider ?? null;
		} catch {
			return null;
		}
	}

	private async isCurrentProvider(): Promise<boolean> {
		return (await this.getCurrentModelProvider()) === this.provider;
	}

	private hasLoadedOrDownloadedModel(models: ModelsResponse | null): boolean {
		return (
			models?.data.some(
				(model) => model.loaded === true || model.downloaded === true,
			) ?? false
		);
	}
}
