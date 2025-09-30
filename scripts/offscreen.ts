// Offscreen document for background knowledge graph processing
// This runs in a hidden document with full DOM access for LLM/Embedding services
import { logError, logInfo, logWarn } from "@/utils/logger";
import {
	backgroundProcessFactory,
	ProcessFactory,
} from "@/services/background-jobs/offscreen-handlers";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { JobNotificationMessage } from "@/services/background-jobs/bridges";
import type { BaseJob } from "@/services/background-jobs/offscreen-handlers/types";

// Import process handlers and factory
import type { ProcessDependencies } from "@/services/background-jobs/offscreen-handlers/types";
import type {
	JobProgressUpdate,
	JobResult,
} from "@/services/background-jobs/offscreen-handlers/types";

import { serviceManager } from "@/services";
import { sharedStorageService } from "@/services/shared-storage";
import { logger } from "@/utils/logger";
import { EmbeddingServiceMain } from "@/services/embedding/embedding-service-main";
import { EmbeddingServiceCore } from "@/services/embedding/embedding-service-core";

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
	currentProgress = {
		done: false,
		progress: 0,
		services: [] as string[],
		status: "Initializing...",
	};
	private ticking = false;
	private tickRequested = false;
	private processFactory: ProcessFactory;
	private dependencies: ProcessDependencies;

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

		this.initialize();
	}

	private setupInitialMessageListener(): void {
		try {
			chrome.runtime?.onMessage.addListener(
				(message, _sender, sendResponse) => {
					logInfo("🔔 OffscreenProcessor received message:", message.type);

					if (message.type === "INITIAL") {
						logInfo("🚀 OffscreenProcessor handling INITIAL message");
						logInfo("📊 Current progress:", this.currentProgress);
						this.reportProgress();
						sendResponse(true);
						return true;
					}
				},
			);
			logInfo("✅ OffscreenProcessor INITIAL message listener registered");
		} catch (error) {
			logWarn("Failed to add INITIAL message listener:", error);
		}
	}

	private async initialize(): Promise<void> {
		try {
			this.reportProgress();

			logger.info(
				"offscreen",
				"initialization",
				"🚀 Starting offscreen processor initialization",
			);

			// Initialize shared storage service first
			logger.info(
				"offscreen",
				"SharedStorageService",
				"🔄 Initializing SharedStorageService...",
			);
			this.currentProgress.progress = 10;
			this.currentProgress.status = "Initializing SharedStorageService...";
			this.reportProgress();

			await sharedStorageService.initialize();
			logger.info(
				"offscreen",
				"SharedStorageService",
				"✅ SharedStorageService initialized",
			);
			this.currentProgress.services.push("SharedStorageService");
			this.currentProgress.progress = 30;
			this.currentProgress.status = "Initializing ServiceManager...";
			this.reportProgress();

			// Initialize all services via ServiceManager (centralized)
			// ServiceManager handles all service initialization - no need for manual initialization
			logger.info(
				"offscreen",
				"ServiceManager",
				"🔄 Initializing all services via ServiceManager...",
			);
			await serviceManager.initialize({
				proxy: false,
				callback: (service: string, progress) => {
					this.currentProgress.progress = 30 + progress * 0.6; // 30% + 60% of serviceManager progress
					this.currentProgress.status = `Initializing ${service}... (${progress}%)`;
					this.reportProgress();
				},
			});
			logger.info(
				"offscreen",
				"ServiceManager",
				"✅ All services initialized via ServiceManager",
			);

			this.currentProgress.progress = 90;
			this.currentProgress.status = "Starting job queue processing...";
			this.reportProgress();

			// Begin processing queue before announcing readiness so message handlers are live
			await this.startQueueProcessing();
			logger.info("offscreen", "queue", "✅ Job queue processing loop started");

			this.currentProgress.progress = 100;
			this.currentProgress.status = "Ready";
			this.currentProgress.done = true;
			this.reportProgress();

			logger.info(
				"offscreen",
				"initialization",
				"🎉 All services initialized - ready for background processing",
			);

			// Notify background that offscreen is ready once handlers are registered
			try {
				chrome.runtime?.sendMessage?.({ type: "OFFSCREEN_READY" });
			} catch (_) {}
		} catch (error) {
			logError("Failed to initialize offscreen processor:", error);
			this.currentProgress.status = "Failed";
			this.currentProgress.done = true;
			this.reportProgress();
			logger.error(
				"offscreen",
				"initialization",
				"❌ Initialization failed",
				error,
			);
		}
	}
	private async startQueueProcessing(): Promise<void> {
		const processQueueJobs = async () => {
			if (this.ticking) {
				this.tickRequested = true;
				return;
			}
			this.ticking = true;
			try {
				await this.processQueueJobs();
			} finally {
				this.ticking = false;
				if (this.tickRequested) {
					this.tickRequested = false;
					logger.debug("offscreen", "queue", "🔄 Restarting queue processing");
					return processQueueJobs();
				}
			}
		};

		const processFastMessage = async (message: JobNotificationMessage) => {
			// Fast processing - no ticking mechanism, direct parallel execution
			await this.processFastJobs(message);
		};

		// Setup separate queue and fast message handling
		await this.setupMessageHandling(processQueueJobs, processFastMessage);

		// Initial queue processing
		logger.info("offscreen", "queue", "🎬 Running initial queue processing");
		void processQueueJobs();

		// Delayed queue check
		setTimeout(() => {
			logger.info("offscreen", "queue", "🛡️ Safety queue check");
			void processQueueJobs();
		}, 120000);

		// Backup safety interval for queue processing
		setInterval(() => {
			logger.info("offscreen", "queue", "🛡️ Safety interval check");
			void processQueueJobs();
		}, 120000);

		logger.info(
			"offscreen",
			"queue",
			"✅ Event-driven job processing system initialized",
		);
	}

	private updateInitialProgress() {}

	private async processQueueJobs(): Promise<void> {
		logger.info(
			"offscreen",
			"queue",
			"🔄 Queue processing: Reading from IndexedDB storage",
			{ timestamp: new Date().toISOString() },
		);

		try {
			// Get jobs from IndexedDB storage for heavy processing
			const response = await chrome.runtime.sendMessage({
				type: "GET_BACKGROUND_JOBS",
			});

			if (response?.success && response?.jobs) {
				// Process jobs from response
				for (const job of response.jobs) {
					if (!job || job.status !== "pending") {
						logger.debug(
							"offscreen",
							"queue",
							"⏭️ Skipping non-pending job from storage",
							{ jobId: job?.id, status: job?.status },
						);
						continue;
					}
					logger.info("offscreen", "queue", "📋 Processing job from storage", {
						jobId: job.id,
					});

					// Process jobs ONE BY ONE sequentially for heavy processes
					await this.processClaimedJob(job);
				}
			}
		} catch (error) {
			logError("❌ Queue processing failed", error);
		}
	}

	private async processFastJobs(
		message: JobNotificationMessage,
	): Promise<void> {
		logInfo("⚡ Fast processing: Direct communication channel", {
			messageType: message.type,
			jobId: message.jobId,
		});

		// Handle fast jobs directly from message - parallel processing
		if (message.type === "JOB_ENQUEUED" && message.job) {
			// Process immediately without storage - direct handler execution
			const jobData: BaseJob = message.job;

			// Parallel processing - don't await, handle immediately
			void this.processFastJob(jobData);
		}
	}

	private async processFastJob(job: BaseJob): Promise<void> {
		try {
			logInfo("⚡ Processing fast job", {
				jobId: job.id,
				type: job.jobType,
			});

			// Direct handler execution without claiming
			await this.processClaimedJob(job);
		} catch (error) {
			logError("❌ Fast job processing failed", { error, jobId: job.id });
		}
	}

	private async setupMessageHandling(
		processQueueJobs: () => Promise<void>,
		processFastMessage: (message: JobNotificationMessage) => Promise<void>,
	): Promise<void> {
		try {
			// Subscribe only to JOB_ENQUEUED messages intended for offscreen processing
			backgroundJob
				.getNotificationBridge()
				.subscribe("JOB_ENQUEUED", async (message: JobNotificationMessage) => {
					// FAST: Direct processing
					logInfo("⚡ Fast processing: Direct communication channel", {
						jobId: message.jobId,
						jobType: message.job?.jobType,
					});
					await processFastMessage(message);
				});

			// Subscribe to other job events that might trigger queue processing
			backgroundJob
				.getNotificationBridge()
				.subscribe("JOB_UPDATED", async (message: JobNotificationMessage) => {
					// Only trigger queue processing when a pending job update arrives
					const jobStatus = message.job?.status;
					if (jobStatus && jobStatus !== "pending") {
						logger.debug(
							"offscreen",
							"queue",
							"⏭️ Ignoring JOB_UPDATED for non-pending job",
							{ jobId: message.jobId, jobStatus },
						);
						return;
					}

					// QUEUE: Trigger queue processing for updates
					void processQueueJobs();
				});

			logInfo(
				"🎧 JobNotificationChannel handlers registered for offscreen",
				{},
			);
		} catch (err) {
			logError("❌ Failed to register message handlers", err);
		}
	}

	private async processClaimedJob(job: BaseJob): Promise<void> {
		// Use the new standardized execution with automatic completion and error handling
		await this.processFactory.executeJob(job.id, job);
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
			logger.error(
				"offscreen",
				"queue",
				`❌ Failed to send job progress update: ${jobId}`,
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
			logger.error(
				"offscreen",
				"queue",
				`❌ Failed to send job completion: ${jobId}`,
				error,
			);
		}
	}

	// Report current progress to UI thread
	reportProgress(): void {
		logInfo("📤 Sending INITIAL_PROGRESS:", this.currentProgress);
		try {
			chrome.runtime?.sendMessage?.({
				type: "INITIAL_PROGRESS",
				currentProgress: this.currentProgress,
			});
			logInfo("✅ INITIAL_PROGRESS message sent successfully");
		} catch (error) {
			logError("❌ Failed to send INITIAL_PROGRESS:", error);
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
				logger.info(
					"offscreen",
					"startup",
					"🚀 Offscreen document script started",
					{ timestamp: new Date().toISOString() },
				);
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

	// Keep the offscreen document alive
	setInterval(() => {
		// This prevents the offscreen document from being terminated
		logInfo("Offscreen document heartbeat");
	}, 30000); // Every 30 seconds
}

if (!offscreenGlobal.__memorallOffscreenProcessor__) {
	offscreenGlobal.__memorallOffscreenProcessor__ = new OffscreenProcessor();
} else {
	console.info(
		"♻️ OffscreenProcessor already initialized; reusing existing instance.",
	);
}
