import { embeddingService } from "./embedding";
import { llmService } from "./llm";
import { flowsService } from "./flows/flows-service";
import { databaseService } from "./database";
import { logError, logInfo, logWarn } from "@/utils/logger";

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

	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = this.initializeServices();
		await this.initPromise;
		this.initialized = true;
	}

	private async initializeServices(): Promise<void> {
		logInfo("🚀 Initializing services...");
		this.updateProgress("Initializing services", 5);

		try {
			// Initialize services sequentially for better progress tracking
			await this.initializeDatabase();
			this.updateProgress("Database ready", 5, "database");

			await this.initializeEmbeddingService();
			this.updateProgress("Embedding models loaded", 75, "embedding");

			await this.initializeLLMService();
			this.updateProgress("LLM service ready", 80, "llm");

			await this.initializeFlowsService();
			this.updateProgress("All services ready", 100, "flows");

			logInfo("✅ All services initialized successfully");
		} catch (error) {
			logError("❌ Failed to initialize services:", error);
			this.updateProgress("All services ready", 100, "flows");
			throw error;
		}
	}

	private async initializeDatabase(): Promise<void> {
		try {
			logInfo("📚 Initializing database...");
			this.updateProgress(
				"Setting up knowledge graph database",
				10,
				"database",
			);
			await databaseService.initialize();
			this.serviceStatus.database = true;
			logInfo("✅ Database initialized");
		} catch (error) {
			logError("❌ Database initialization failed:", error);
			throw new Error(
				`Database initialization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	}

	private async initializeEmbeddingService(): Promise<void> {
		try {
			logInfo("🔤 Initializing embedding service...");
			this.updateProgress(
				"Loading embedding models for semantic search",
				35,
				"embedding",
			);
			// Create default embedding
			await embeddingService.create("default", "local", {
				type: "local",
				modelName: "nomic-ai/nomic-embed-text-v1.5",
			});
			this.serviceStatus.embedding = true;
			logInfo("✅ Embedding service initialized");
		} catch (error) {
			logError("❌ Embedding service initialization failed:", error);
			this.serviceStatus.embedding = false;
			// Don't throw - embedding service failure shouldn't block the app
			logWarn("⚠️ Continuing without embedding service");
			logError("Full error details:", error);
		}
	}

	private async initializeLLMService(): Promise<void> {
		try {
			logInfo("🦙 Initializing LLM service...");
			this.updateProgress(
				"Initializing local LLM inference service",
				60,
				"llm",
			);
			await llmService.initialize();
			this.serviceStatus.llm = true;
			logInfo("✅ LLM service initialized");
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
		const embedding = await embeddingService.get("default");
		return this.serviceStatus.embedding && embedding
			? embedding.isReady()
			: false;
	}

	isLLMServiceReady(): boolean {
		return this.serviceStatus.llm && llmService.isReady();
	}

	isDatabaseReady(): boolean {
		return this.serviceStatus.database && databaseService.isReady();
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
		return embeddingService;
	}

	getLLMService() {
		return llmService;
	}

	getDatabaseService() {
		return databaseService;
	}

	getFlowsService() {
		return flowsService;
	}
}

// Export singleton instance
export const serviceManager = ServiceManager.getInstance();
