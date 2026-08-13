// Offscreen document for background knowledge graph processing
// This runs in a hidden document with full DOM access for LLM/Embedding services
import { logDebug, logError, logInfo, logWarn } from "@/utils/logger";
import {
	backgroundProcessFactory,
	ProcessFactory,
} from "@/services/background-jobs/handlers";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { OffscreenProgress } from "@/services/background-jobs/bridges";

// Import process handlers and factory
import type { ProcessDependencies } from "@/services/background-jobs/handlers/types";
import type {
	JobProgressUpdate,
	JobResult,
} from "@/services/background-jobs/handlers/types";

import { serviceManager } from "@/services";
import { sharedStorageService } from "@/services/shared-storage";
import { EmbeddingServiceMain } from "@/services/embedding/embedding-service-main";
import { EmbeddingServiceCore } from "@/services/embedding/embedding-service-core";
import {
	DEFAULT_ON_DEMAND_SERVICE_CONFIGS,
	type DefaultOnDemandServiceName,
} from "@/services/llm/constants";
import { RuntimeProcessor } from "@/services/runtime/runtime-processor";

type OffscreenGlobal = typeof globalThis & {
	__memorallOffscreenProcessor__?: OffscreenProcessor;
	__memorallOffscreenSetupDone__?: boolean;
	__memorallOffscreenStartLogged__?: boolean;
	__memorallEmbeddingPatchDone__?: boolean;
};

const offscreenGlobal = globalThis as OffscreenGlobal;

type PatchedEmbeddingService = EmbeddingServiceMain & {
	__memorallSkipDefaultEmbedding__?: boolean;
};

if (!offscreenGlobal.__memorallEmbeddingPatchDone__) {
	const embeddingMainProto =
		EmbeddingServiceMain.prototype as unknown as Record<
			string,
			(this: PatchedEmbeddingService) => Promise<void>
		>;
	const coreProto = EmbeddingServiceCore.prototype as unknown as Record<
		string,
		(this: PatchedEmbeddingService) => Promise<void>
	>;
	const originalInitialize: () => Promise<void> = embeddingMainProto.initialize;
	const baseEnsureDefault: () => Promise<void> =
		coreProto.ensureDefaultEmbedding;

	embeddingMainProto.ensureDefaultEmbedding = async function (
		this: PatchedEmbeddingService,
	): Promise<void> {
		if (this.__memorallSkipDefaultEmbedding__) {
			// Defer default creation; ServiceManager will create the initial model explicitly.
			return;
		}
		return baseEnsureDefault.call(this);
	};

	embeddingMainProto.initialize = async function (
		this: PatchedEmbeddingService,
	): Promise<void> {
		this.__memorallSkipDefaultEmbedding__ = true;
		try {
			await originalInitialize.call(this);
		} finally {
			delete this.__memorallSkipDefaultEmbedding__;
		}
	};

	offscreenGlobal.__memorallEmbeddingPatchDone__ = true;
}

class OffscreenProcessor {
	currentProgress: OffscreenProgress & { services: string[] } = {
		done: false,
		progress: 0,
		services: [] as string[],
		status: "Initializing...",
	};
	private processFactory: ProcessFactory;
	private dependencies: ProcessDependencies;
	private runtimeProcessor: RuntimeProcessor | null = null;

	constructor() {
		// Initialize dependencies for dependency injection
		this.dependencies = ProcessFactory.createDependencies(
			this.updateJobProgress.bind(this),
			this.completeJob.bind(this),
		);
		this.processFactory = backgroundProcessFactory;
		this.processFactory.setDependencies(this.dependencies);

		// Set up message listener for INITIAL command
		this.setupInitialMessageListener();

		// Send initial progress immediately to let UI know we're starting
		this.reportProgress();

		this.initialize();

		logInfo(`[OFFSCREEN] construct`);
	}

	private setupInitialMessageListener(): void {
		try {
			const listener = (
				message: any,
				sender: chrome.runtime.MessageSender,
				sendResponse: (response?: any) => void,
			): boolean => {
				if (message && message.type === "REQUEST_PROGRESS") {
					logInfo("📨 Received REQUEST_PROGRESS - sending current status");
					this.reportProgress();
					return false;
				}

				if (message && message.type === "OFFSCREEN_RESET_LLM_SERVICE") {
					const serviceName = message.service as DefaultOnDemandServiceName;
					(async () => {
						try {
							logInfo(
								`🔄 [OFFSCREEN] Resetting LLM service iframe: ${serviceName}`,
							);
							serviceManager.llmService.remove(serviceName);
							const config = DEFAULT_ON_DEMAND_SERVICE_CONFIGS[serviceName];
							if (!config) {
								sendResponse({
									success: false,
									error: `Unknown service: ${serviceName}`,
								});
								return;
							}
							await serviceManager.llmService.create(serviceName, config);
							logInfo(
								`✅ [OFFSCREEN] LLM service iframe reset: ${serviceName}`,
							);
							sendResponse({ success: true });
						} catch (error) {
							logError(
								`❌ [OFFSCREEN] Failed to reset LLM service ${serviceName}:`,
								error,
							);
							sendResponse({
								success: false,
								error: error instanceof Error ? error.message : "Reset failed",
							});
						}
					})();
					return true;
				}

				if (message && message.type === "OFFSCREEN_GET_SERVICE_STATUS") {
					const statuses: Record<
						string,
						{ registered: boolean; ready: boolean }
					> = {
						webllm: {
							registered: serviceManager.llmService.has("webllm"),
							ready: serviceManager.llmService.isReadyByName("webllm"),
						},
						wllama: {
							registered: serviceManager.llmService.has("wllama"),
							ready: serviceManager.llmService.isReadyByName("wllama"),
						},
						transformer: {
							registered: serviceManager.llmService.has("transformer"),
							ready: serviceManager.llmService.isReadyByName("transformer"),
						},
					};
					sendResponse({ success: true, statuses });
					return false;
				}

				return false;
			};

			chrome.runtime.onMessage.addListener(listener);
			logInfo("✅ OffscreenProcessor progress request listener registered");
		} catch (error) {
			logError("❌ Failed to add progress request listener:", error);
		}
	}

	private async initialize(): Promise<void> {
		try {
			this.currentProgress.done = false;
			delete this.currentProgress.error;
			this.reportProgress();

			logInfo(`[OFFSCREEN] init`);

			// Initialize shared storage service first
			logInfo("🔄[OFFSCREEN] Initializing SharedStorageService...");
			this.currentProgress.progress = 10;
			this.currentProgress.status = "Initializing SharedStorageService...";
			this.reportProgress();

			await sharedStorageService.initialize();
			logInfo("✅[OFFSCREEN] SharedStorageService initialized");
			this.currentProgress.services.push("SharedStorageService");
			this.currentProgress.progress = 30;
			this.currentProgress.status = "Initializing ServiceManager...";
			this.reportProgress();

			// Initialize all services via ServiceManager (centralized)
			// ServiceManager handles all service initialization - no need for manual initialization
			logInfo("🔄[OFFSCREEN] Initializing all services via ServiceManager...");
			await serviceManager.initialize({
				proxy: false,
				callback: (service: string, progress) => {
					this.currentProgress.progress = 30 + progress * 0.6; // 30% + 60% of serviceManager progress
					this.currentProgress.status = `Initializing ${service}... (${progress}%)`;
					this.reportProgress();
				},
			});
			logInfo("✅[OFFSCREEN] All services initialized via ServiceManager");

			this.currentProgress.progress = 90;
			this.currentProgress.status = "Starting job queue processing...";
			this.reportProgress();

			// Begin processing queue before announcing readiness so message handlers are live
			await this.startQueueProcessing();
			logInfo("✅[OFFSCREEN] Job queue processing loop started");

			this.currentProgress.progress = 100;
			this.currentProgress.status = "Ready";
			this.currentProgress.done = true;
			this.reportProgress();

			logInfo(
				"🎉[OFFSCREEN] All services initialized - ready for background processing",
			);

			// Notify background that offscreen is ready once handlers are registered
			try {
				chrome.runtime?.sendMessage?.({ type: "OFFSCREEN_READY" });
			} catch (_) {}
		} catch (error) {
			this.currentProgress.status = "Failed";
			this.currentProgress.done = true;
			this.currentProgress.error =
				error instanceof Error
					? error.message
					: typeof error === "string"
						? error
						: "Unknown offscreen initialization error";
			this.reportProgress();
			logError("❌[OFFSCREEN] Initialization failed", error);
		}
	}
	private async startQueueProcessing(): Promise<void> {
		this.runtimeProcessor = new RuntimeProcessor({
			notifications: backgroundJob.getNotificationBridge(),
			listPendingJobs: async () => {
				const response = await chrome.runtime.sendMessage({
					type: "GET_BACKGROUND_JOBS",
				});
				return response?.success && Array.isArray(response.jobs)
					? response.jobs
					: [];
			},
			executeJob: (job) => this.processFactory.executeJob(job.id, job),
			safetyIntervalMs: 120_000,
			logger: {
				debug: (message, data) => logDebug(message, data),
				info: (message, data) => logInfo(message, data),
				error: (message, error) => logError(message, error),
			},
		});
		await this.runtimeProcessor.start();
	}

	// Helper method to update job progress via background script message
	private async updateJobProgress(
		jobId: string,
		progress: JobProgressUpdate,
	): Promise<void> {
		try {
			await backgroundJob.getNotificationBridge().notifyJobProgress(
				jobId,
				{
					...progress,
					status: "pending",
				},
				"all",
			);
		} catch (error) {
			logError(
				`❌[OFFSCREEN] Failed to send job progress update: ${jobId}`,
				error,
			);
		}
	}

	// Helper method to complete job via backgroundJob's notification bridge
	private async completeJob(jobId: string, result: JobResult): Promise<void> {
		try {
			// Send completion via backgroundJob's notification bridge to background context
			backgroundJob
				.getNotificationBridge()
				.notifyJobCompleted(jobId, result, "all");
		} catch (error) {
			logError(`❌[OFFSCREEN] Failed to send job completion: ${jobId}`, error);
		}
	}

	// Report current progress to UI thread
	reportProgress(): void {
		logInfo("📤 Broadcasting progress:", this.currentProgress);
		try {
			// Store in SharedStorageService (IndexedDB)
			sharedStorageService
				.set("offscreenProgress", this.currentProgress)
				.then(() => {
					logInfo("✅ Progress written to SharedStorage");
				})
				.catch((error: Error) => {
					logError("❌ Failed to write to SharedStorage:", error);
				});

			// Broadcast via message for listeners
			chrome.runtime?.sendMessage?.({
				type: "INITIAL_PROGRESS",
				currentProgress: this.currentProgress,
			});
		} catch (error) {
			logError("❌ Failed to update progress:", error);
		}
	}
}

// Initialize the offscreen processor
if (!offscreenGlobal.__memorallOffscreenSetupDone__) {
	logInfo("🚀 OFFSCREEN HTML LOADED!");
	try {
		const statusEl = document.getElementById("status");
		if (statusEl) {
			statusEl.textContent = "OFFSCREEN: HTML Loaded!";
			(statusEl as HTMLElement).style.display = "block";
		}
	} catch (_) {}

	logInfo("🚀 Offscreen document script loading...");
	offscreenGlobal.__memorallOffscreenSetupDone__ = true;

	if (!offscreenGlobal.__memorallOffscreenStartLogged__) {
		offscreenGlobal.__memorallOffscreenStartLogged__ = true;
		void (async () => {
			try {
				logInfo("🚀[OFFSCREEN] Offscreen document script started", {
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logWarn("Failed to initialize logger for offscreen start log:", error);
			}
		})();
	}

	// Add message listener for ping/status checks
	try {
		chrome.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
			if (message.type === "PING_OFFSCREEN") {
				sendResponse(true);
				return true;
			}
		});
		logInfo("✅ Basic message listener registered for PING");
	} catch (error) {
		logWarn("Failed to add message listener:", error);
	}

	// Keep the offscreen document alive without recurring logs.
	setInterval(() => {
		// The timer tick itself is enough to keep the offscreen document active.
		void offscreenGlobal.__memorallOffscreenSetupDone__;
	}, 30000); // Every 30 seconds
}

if (!offscreenGlobal.__memorallOffscreenProcessor__) {
	console.info("♻️ OffscreenProcessor init;");
	offscreenGlobal.__memorallOffscreenProcessor__ = new OffscreenProcessor();
} else {
	console.info(
		"♻️ OffscreenProcessor already initialized; reusing existing instance.",
	);
}

// Default export for Extension.js development mode
export default function main() {
	// Return cleanup function
	return () => {
		logInfo("🧹 Offscreen document cleaned up");
	};
}
