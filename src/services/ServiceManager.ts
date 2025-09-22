import { logError, logInfo, logWarn } from "@/utils/logger";
import type { IEmbeddingService } from "./embedding";
import {
	EmbeddingServiceMain,
	EmbeddingServiceProxy,
} from "./embedding";
import type { ILLMService } from "./llm/interfaces/llm-service.interface";
import { LLMServiceProxy, LLMServiceMain } from "./llm";
import { flowsService } from "./flows/flows-service";
import { DatabaseMode, DatabaseService } from "./database";

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
		flows: false,
	};

	// Child services - initialized based on mode
	public embeddingService!: IEmbeddingService;
	public llmService!: ILLMService;
	public databaseService!: DatabaseService;

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
			// Create service instances based on mode
			if (options.proxy) {
				logInfo("🔧 Creating lite service implementations");
				this.databaseService = DatabaseService.getInstance();
				await this.initializeDatabase({ mode: DatabaseMode.PROXY });
				this.embeddingService = new EmbeddingServiceProxy();
				this.llmService = new LLMServiceProxy();
			} else {
				logInfo("🔧 Creating full service implementations");
				this.databaseService = DatabaseService.getInstance();
				await this.initializeDatabase({ mode: DatabaseMode.MAIN });
				this.embeddingService = new EmbeddingServiceMain();
				this.llmService = new LLMServiceMain();
			}

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
			options.callback?.("flow", 100);
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
			logInfo("📚 Initializing database...");
			this.updateProgress(
				"Setting up knowledge graph database",
				10,
				"database",
			);
			await this.databaseService.initialize(options);
			this.serviceStatus.database = true;
			logInfo("✅ Database initialized");
		} catch (error) {
			logError("❌ Database initialization failed:", error);
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

			await this.embeddingService.initialize();

			if (!liteMode) {
				// Full mode: Create default embedding model
				await this.embeddingService.create("default", "local", {
					type: "local",
					modelName: "nomic-ai/nomic-embed-text-v1.5",
				});
				logInfo("✅ Embedding service initialized with local models");
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
			await flowsService.initialize();
			this.serviceStatus.flows = true;
			logInfo("✅ Flows service initialized");
		} catch (error) {
			logError("❌ Flows service initialization failed:", error);
			this.serviceStatus.flows = false;
			// Don't throw - Flows service failure shouldn't block the app
			logWarn("⚠️ Continuing without Flows service");
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

	getFlowsService() {
		return flowsService;
	}
}
