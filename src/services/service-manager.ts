import { logError, logInfo, logWarn } from "@/utils/logger";
import type { IEmbeddingService } from "@/services/embedding";
import type { ISandboxContainerService } from "@/services/sandbox-container";
import type { IWebBrowserService } from "@/services/web-browser";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { ICronJobService } from "@/services/cron-jobs";
import { FlowsService } from "./flows-service";
import { FlowBuilderService } from "./flow-builder-service";
import { DatabaseMode } from "./database/constants";
import type { IDatabaseService } from "./database/interfaces/database-service.interface";
import {
	getCurrentEmbeddingInfo,
	getCurrentModelId,
	initializeEmbeddingSize,
} from "@/utils/embedding-size-config";

export interface InitializationProgress {
	step: string;
	progress: number; // 0-100
	currentService?: string;
	isComplete: boolean;
}

export class ServiceManager {
	private static instance: ServiceManager;
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private serviceStatus = {
		database: false,
		embedding: false,
		llm: false,
		sandbox: false,
		webBrowser: false,
		flows: false,
		flowBuilder: false,
		cronJobs: false,
		topic: false,
	};

	// Child services - initialized based on mode
	public embeddingService!: IEmbeddingService;
	public llmService!: ILLMService;
	public sandboxContainerService!: ISandboxContainerService;
	public webBrowserService!: IWebBrowserService;
	public databaseService!: IDatabaseService;
	public flowsService!: FlowsService;
	public flowBuilderService!: FlowBuilderService;
	public cronJobService!: ICronJobService;

	// Progress tracking
	private progressListeners = new Set<
		(progress: InitializationProgress) => void
	>();
	private currentProgress: InitializationProgress = {
		step: "Starting",
		progress: 0,
		isComplete: false,
	};

	private constructor() {}

	static getInstance(): ServiceManager {
		if (!ServiceManager.instance) {
			ServiceManager.instance = new ServiceManager();
		}
		return ServiceManager.instance;
	}

	// Progress tracking methods
	onProgressChange(
		listener: (progress: InitializationProgress) => void,
	): () => void {
		this.progressListeners.add(listener);
		// Send current progress immediately
		listener(this.currentProgress);
		return () => this.progressListeners.delete(listener);
	}

	private updateProgress(
		step: string,
		progress: number,
		currentService?: string,
	): void {
		this.currentProgress = {
			step,
			progress,
			currentService,
			isComplete: progress >= 100,
		};
		this.progressListeners.forEach((listener) =>
			listener(this.currentProgress),
		);
	}

	getCurrentProgress(): InitializationProgress {
		return { ...this.currentProgress };
	}

	async initialize(
		options: {
			proxy?: boolean;
			callback?: (service: string, progress: number) => void;
		} = {
			proxy: false,
			callback: undefined,
		},
	): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.initializeServices(options);
		await this.initPromise;
		this.initialized = true;
	}

	private async initializeServices(
		options: {
			proxy?: boolean;
			callback?: (service: string, progress: number) => void;
		} = {
			proxy: false,
			callback: undefined,
		},
	): Promise<void> {
		const mode = options.proxy ? "proxy mode" : "full mode";
		logInfo(`🚀 Initializing services in ${mode}...`);
		this.updateProgress(`Initializing services (${mode})`, 5);

		try {
			if (options.proxy) {
				logInfo("🔧 Creating lite service implementations (popup thread)");

				// Dynamic imports prevent ALL heavy modules from loading in popup:
				// - DatabaseServiceProxy: NO @electric-sql/pglite, NO drizzle-orm/pg-core schemas
				// - EmbeddingServiceProxy: NO @huggingface/transformers, NO onnxruntime-web
				// - LLMServiceProxy: NO WebLLM, NO Wllama
				// This keeps popup thread lightweight and responsive
				const { DatabaseServiceProxy } = await import(
					"@/services/database/database-service-proxy"
				);
				const { EmbeddingServiceProxy } = await import(
					"@/services/embedding/embedding-service-proxy"
				);
				const { sandboxContainerServiceProxy } = await import(
					"@/services/sandbox-container/sandbox-container-service-proxy"
				);
				const { webBrowserServiceProxy } = await import(
					"@/services/web-browser/web-browser-service-proxy"
				);
				const { LLMServiceProxy } = await import(
					"@/services/llm/llm-service-proxy"
				);
				const { CronJobServiceProxy } = await import("@/services/cron-jobs");

				this.databaseService = new DatabaseServiceProxy();
				await this.initializeDatabase({ mode: DatabaseMode.PROXY });
				this.flowBuilderService = new FlowBuilderService(this.databaseService);
				this.cronJobService = new CronJobServiceProxy(this.databaseService);

				this.embeddingService = new EmbeddingServiceProxy();
				this.sandboxContainerService = sandboxContainerServiceProxy;
				this.webBrowserService = webBrowserServiceProxy;
				this.llmService = new LLMServiceProxy();
				this.flowsService = new FlowsService();
			} else {
				logInfo("🔧 Creating full service implementations (offscreen thread)");

				// Dynamic imports load full implementations ONLY in offscreen thread:
				// - DatabaseServiceMain: Full PGlite + Drizzle with schemas
				// - EmbeddingServiceMain: @huggingface/transformers + onnxruntime-web
				// - LLMServiceMain: WebLLM + Wllama + full model loading
				const { DatabaseServiceMain } = await import(
					"@/services/database/database-service-main"
				);
				const { EmbeddingServiceMain } = await import(
					"@/services/embedding/embedding-service-main"
				);
				const { sandboxContainerMainService } = await import(
					"@/services/sandbox-container/sandbox-container-service-main"
				);
				const { webBrowserMainService } = await import(
					"@/services/web-browser/web-browser-service-main"
				);
				const { LLMServiceMain } = await import(
					"@/services/llm/llm-service-main"
				);
				const { CronJobServiceMain } = await import("@/services/cron-jobs");

				this.databaseService = new DatabaseServiceMain();
				await this.initializeDatabase({ mode: DatabaseMode.MAIN });
				this.flowBuilderService = new FlowBuilderService(this.databaseService);
				this.cronJobService = new CronJobServiceMain(this.databaseService);

				this.embeddingService = new EmbeddingServiceMain();
				this.sandboxContainerService = sandboxContainerMainService;
				this.webBrowserService = webBrowserMainService;
				this.llmService = new LLMServiceMain();
				this.flowsService = new FlowsService();
			}

			this.serviceStatus.sandbox = true;
			this.serviceStatus.webBrowser = true;

			options.callback?.("database", 0);
			// Initialize services sequentially for better progress tracking

			options.callback?.("database", 100);
			this.updateProgress("Database ready", 25, "database");

			if (options.proxy) {
				// Lite mode: Initialize services without heavy operations
				await this.initializeEmbeddingService(true);
				this.updateProgress("Embedding service ready (lite)", 50, "embedding");

				await this.initializeLLMService(true);
				this.updateProgress("LLM service ready (lite)", 75, "llm");
			} else {
				// Full mode: Initialize all services normally
				options.callback?.("embedding", 0);
				await this.initializeEmbeddingService(false);
				options.callback?.("embedding", 100);
				this.updateProgress("Embedding models loaded", 50, "embedding");

				options.callback?.("llm", 0);
				await this.initializeLLMService(false);
				options.callback?.("llm", 100);
				this.updateProgress("LLM service ready", 75, "llm");
			}

			options.callback?.("flow", 0);
			await this.initializeFlowsService();

			options.callback?.("cronJobs", 0);
			await this.initializeCronJobService(options.proxy ?? false);
			options.callback?.("cronJobs", 100);

			this.serviceStatus.flowBuilder = true;
			this.updateProgress("All services ready", 100, "flows");

			logInfo(`✅ All services initialized successfully in ${mode}`);
		} catch (error) {
			logError("❌ Failed to initialize services:", error);
			this.updateProgress("All services ready", 100, "flows");
			throw error;
		}
	}

	private async initializeDatabase(options: {
		mode: DatabaseMode;
	}): Promise<void> {
		try {
			logInfo(`📚 Database "${options.mode}" initializing...`);
			this.updateProgress(
				"Setting up knowledge graph database",
				10,
				"database",
			);
			await this.databaseService.initialize({
				...options,
				proxyOptions: {
					channelName: "postgres-rpc",
				},
			});
			this.serviceStatus.database = true;
			logInfo(`✅ Database "${options.mode}" initialized`);
		} catch (error) {
			logError(`❌ Database "${options.mode}" initialization failed:`, error);
			throw new Error(
				`Database initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	private async initializeEmbeddingService(
		liteMode: boolean = false,
	): Promise<void> {
		try {
			logInfo(
				`🔤 Initializing embedding service${liteMode ? " (lite mode)" : ""}...`,
			);
			this.updateProgress(
				liteMode
					? "Setting up embedding service proxy"
					: "Loading embedding models for semantic search",
				35,
				"embedding",
			);

			// Initialize embedding size configuration BEFORE loading model
			if (!liteMode) {
				await initializeEmbeddingSize(this.databaseService);
				logInfo("✅ Embedding size configuration initialized");
			}

			await this.embeddingService.initialize();

			if (!liteMode) {
				// Full mode: Create default embedding model with configured size
				const modelId = await getCurrentModelId();
				const embeddingInfo = await getCurrentEmbeddingInfo();

				if (!modelId) {
					throw new Error(
						`Embedding size "${embeddingInfo.size}" requires remote API and cannot be used in local mode`,
					);
				}

				await this.embeddingService.create("default", "worker", {
					type: "worker",
					modelName: modelId,
				});
				logInfo(
					`✅ Embedding service initialized with ${embeddingInfo.size} model (${embeddingInfo.dimensions}d): ${modelId}`,
				);
			} else {
				logInfo(
					"✅ Embedding service initialized in lite mode (will use offscreen for operations)",
				);
			}

			this.serviceStatus.embedding = true;
		} catch (error) {
			logError("❌ Embedding service initialization failed:", error);
			this.serviceStatus.embedding = false;
			// Don't throw - embedding service failure shouldn't block the app
			logWarn("⚠️ Continuing without embedding service");
			logError("Full error details:", error);
		}
	}

	private async initializeLLMService(liteMode: boolean = false): Promise<void> {
		try {
			logInfo(
				`🦙 Initializing LLM service${liteMode ? " (lite mode)" : ""}...`,
			);
			this.updateProgress(
				liteMode
					? "Setting up LLM service proxy"
					: "Initializing local LLM inference service",
				60,
				"llm",
			);

			await this.llmService.initialize();

			if (liteMode) {
				logInfo(
					"✅ LLM service initialized in lite mode (will use offscreen for heavy operations)",
				);
			} else {
				logInfo("✅ LLM service initialized with local models");
			}

			this.serviceStatus.llm = true;
		} catch (error) {
			logError("❌ LLM service initialization failed:", error);
			this.serviceStatus.llm = false;
			// Don't throw - LLM service failure shouldn't block the app
			logWarn("⚠️ Continuing without LLM service");
		}
	}

	private async initializeFlowsService(): Promise<void> {
		try {
			logInfo("🔄 Initializing Flows service...");
			this.updateProgress(
				"Preparing chat interface and model management",
				90,
				"flows",
			);
			await this.flowsService.initialize();
			this.serviceStatus.flows = true;
			logInfo("✅ Flows service initialized");
		} catch (error) {
			logError("❌ Flows service initialization failed:", error);
			this.serviceStatus.flows = false;
			// Don't throw - Flows service failure shouldn't block the app
			logWarn("⚠️ Continuing without Flows service");
		}
	}

	private async initializeCronJobService(
		liteMode: boolean = false,
	): Promise<void> {
		try {
			logInfo(
				`⏰ Initializing cron job service${liteMode ? " (lite mode)" : ""}...`,
			);
			if (!this.cronJobService) {
				this.serviceStatus.cronJobs = false;
				return;
			}
			await this.cronJobService.initialize();
			this.serviceStatus.cronJobs = true;
			logInfo("✅ Cron job service initialized");
		} catch (error) {
			logError("❌ Cron job service initialization failed:", error);
			this.serviceStatus.cronJobs = false;
			logWarn("⚠️ Continuing without cron job service");
		}
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	// Check individual service status
	async isEmbeddingServiceReady(): Promise<boolean> {
		if (!this.embeddingService) return false;
		const embedding = await this.embeddingService.get("default");
		return this.serviceStatus.embedding && embedding
			? embedding.isReady()
			: false;
	}

	isLLMServiceReady(): boolean {
		return (
			this.serviceStatus.llm && this.llmService && this.llmService.isReady()
		);
	}

	isDatabaseReady(): boolean {
		return this.serviceStatus.database && this.databaseService.isReady();
	}

	isFlowsServiceReady(): boolean {
		return this.serviceStatus.flows;
	}

	isFlowBuilderServiceReady(): boolean {
		return this.serviceStatus.flowBuilder;
	}

	// Get overall service status
	getServiceStatus() {
		return {
			...this.serviceStatus,
			overall: this.initialized,
		};
	}

	// Service getters for easy access
	getEmbeddingService() {
		return this.embeddingService;
	}

	getLLMService() {
		return this.llmService;
	}

	getDatabaseService() {
		return this.databaseService;
	}

	getSandboxContainerService() {
		return this.sandboxContainerService;
	}

	getWebBrowserService() {
		return this.webBrowserService;
	}

	getFlowsService() {
		return this.flowsService;
	}

	getFlowBuilderService() {
		return this.flowBuilderService;
	}

	getCronJobService() {
		return this.cronJobService;
	}

	// Generic service getter for dynamic access
	getService<K extends keyof ServiceRegistry>(
		serviceName: K,
	): ServiceRegistry[K] | undefined {
		switch (serviceName) {
			case "database":
				return this.databaseService as ServiceRegistry[K];
			case "embedding":
				return this.embeddingService as ServiceRegistry[K];
			case "llm":
				return this.llmService as ServiceRegistry[K];
			case "sandbox":
				return this.sandboxContainerService as ServiceRegistry[K];
			case "webBrowser":
				return this.webBrowserService as ServiceRegistry[K];
			case "flows":
				return this.flowsService as ServiceRegistry[K];
			case "flowBuilder":
				return this.flowBuilderService as ServiceRegistry[K];
			case "cronJobs":
				return this.cronJobService as ServiceRegistry[K];
			default:
				return undefined;
		}
	}
}

// Service registry for type-safe service access
interface ServiceRegistry {
	database: IDatabaseService;
	embedding: IEmbeddingService;
	llm: ILLMService;
	sandbox: ISandboxContainerService;
	webBrowser: IWebBrowserService;
	flows: FlowsService;
	flowBuilder: FlowBuilderService;
	cronJobs: ICronJobService;
}
