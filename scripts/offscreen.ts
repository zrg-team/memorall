// Offscreen document for background knowledge graph processing
// This runs in a hidden document with full DOM access for LLM/Embedding services
import { logError, logInfo } from "@/utils/logger";
import {
	backgroundProcessFactory,
	ProcessFactory,
} from "@/services/background-jobs/offscreen-handlers";
import { jobNotificationChannel } from "@/services/background-jobs/job-notification-channel";
import type { JobNotificationMessage } from "@/services/background-jobs/job-notification-channel";
import type { BaseJob } from "@/services/background-jobs/offscreen-handlers/types";

// Import process handlers and factory
import type { ProcessDependencies } from "@/services/background-jobs/offscreen-handlers/types";
import type {
	JobProgressUpdate,
	ChromeMessage,
	JobResult,
} from "@/services/background-jobs/offscreen-handlers/types";

import { serviceManager } from "@/services";
import { sharedStorageService } from "@/services/shared-storage";
import { persistentLogger } from "@/services/logging/persistent-logger";
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
			this.updateJobProgressViaMessage.bind(this),
			this.completeJobViaMessage.bind(this),
			this.updateStatus.bind(this),
			this.sendChromeMessage.bind(this),
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
					console.log("🔔 OffscreenProcessor received message:", message.type);

					if (message.type === "INITIAL") {
						console.log("🚀 OffscreenProcessor handling INITIAL message");
						console.log("📊 Current progress:", this.currentProgress);
						this.reportProgress();
						sendResponse(true);
						return true;
					}
				},
			);
			console.log("✅ OffscreenProcessor INITIAL message listener registered");
		} catch (error) {
			console.warn("Failed to add INITIAL message listener:", error);
		}
	}

	private async initialize(): Promise<void> {
		try {
			this.updateStatus("Initializing...");
			this.reportProgress();

			// Initialize persistent logger first before any logging
			try {
				await persistentLogger.initialize();
			} catch (error) {
				console.warn(
					"Failed to initialize persistentLogger in offscreen context:",
					error,
				);
				// Continue anyway - logging will fall back to console only
			}

			persistentLogger.info(
				"🚀 Starting offscreen processor initialization",
				{},
				"offscreen",
			);

			// Initialize shared storage service first
			persistentLogger.info(
				"🔄 Initializing SharedStorageService...",
				{},
				"offscreen",
			);
			this.currentProgress.progress = 10;
			this.currentProgress.status = "Initializing SharedStorageService...";
			this.reportProgress();

			await sharedStorageService.initialize();
			persistentLogger.info(
				"✅ SharedStorageService initialized",
				{},
				"offscreen",
			);
			this.currentProgress.services.push("SharedStorageService");
			this.currentProgress.progress = 30;
			this.currentProgress.status = "Initializing ServiceManager...";
			this.reportProgress();

			// Initialize all services via ServiceManager (centralized)
			// ServiceManager handles all service initialization - no need for manual initialization
			persistentLogger.info(
				"🔄 Initializing all services via ServiceManager...",
				{},
				"offscreen",
			);
			await serviceManager.initialize({
				callback: (service: string, progress) => {
					this.currentProgress.progress = 30 + progress * 0.6; // 30% + 60% of serviceManager progress
					this.currentProgress.status = `Initializing ${service}... (${progress}%)`;
					this.reportProgress();
				},
			});
			persistentLogger.info(
				"✅ All services initialized via ServiceManager",
				{},
				"offscreen",
			);

			this.currentProgress.progress = 90;
			this.currentProgress.status = "Starting job queue processing...";
			this.reportProgress();

			// Begin processing queue before announcing readiness so message handlers are live
			await this.startQueueProcessing();
			persistentLogger.info(
				"✅ Job queue processing loop started",
				{},
				"offscreen",
			);

			this.currentProgress.progress = 100;
			this.currentProgress.status = "Ready";
			this.currentProgress.done = true;
			this.reportProgress();

			this.updateStatus("Ready");
			persistentLogger.info(
				"🎉 All services initialized - ready for background processing",
				{},
				"offscreen",
			);

			// Notify background that offscreen is ready once handlers are registered
			try {
				chrome.runtime?.sendMessage?.({ type: "OFFSCREEN_READY" });
			} catch (_) {}
		} catch (error) {
			logError("Failed to initialize offscreen processor:", error);
			this.updateStatus("Failed");
			this.currentProgress.status = "Failed";
			this.currentProgress.done = true;
			this.reportProgress();
			persistentLogger.error("❌ Initialization failed", error, "offscreen");
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
					persistentLogger.debug(
						"🔄 Restarting queue processing",
						{},
						"offscreen",
					);
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
		persistentLogger.info(
			"🎬 Running initial queue processing",
			{},
			"offscreen",
		);
		void processQueueJobs();

		// Delayed queue check
		setTimeout(async () => {
			persistentLogger.info("🛡️ Safety queue check", {}, "offscreen");
			void processQueueJobs();
		}, 120000);

		// Backup safety interval for queue processing
		setInterval(() => {
			persistentLogger.info("🛡️ Safety interval check", {}, "offscreen");
			void processQueueJobs();
		}, 120000);

		persistentLogger.info(
			"✅ Event-driven job processing system initialized",
			{},
			"offscreen",
		);
	}

	private updateInitialProgress() {}

	private async processQueueJobs(): Promise<void> {
		persistentLogger.info(
			"🔄 Queue processing: Reading from IndexedDB storage",
			{ timestamp: new Date().toISOString() },
			"offscreen",
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
						persistentLogger.debug(
							"⏭️ Skipping non-pending job from storage",
							{ jobId: job?.id, status: job?.status },
							"offscreen",
						);
						continue;
					}
					persistentLogger.info(
						"📋 Processing job from storage",
						{ jobId: job.id },
						"offscreen",
					);

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
			jobNotificationChannel.subscribe(
				"JOB_ENQUEUED",
				async (message: JobNotificationMessage) => {
					// FAST: Direct processing
					await processFastMessage(message);
				},
			);

			// Subscribe to other job events that might trigger queue processing
			jobNotificationChannel.subscribe(
				"JOB_UPDATED",
				async (message: JobNotificationMessage) => {
					// Only trigger queue processing when a pending job update arrives
					const jobStatus = message.job?.status;
					if (jobStatus && jobStatus !== "pending") {
						persistentLogger.debug(
							"⏭️ Ignoring JOB_UPDATED for non-pending job",
							{
								jobId: message.jobId,
								jobStatus,
							},
							"offscreen",
						);
						return;
					}

					// QUEUE: Trigger queue processing for updates
					void processQueueJobs();
				},
			);

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
	private async updateJobProgressViaMessage(
		jobId: string,
		progress: JobProgressUpdate,
	): Promise<void> {
		try {
			const response = await chrome.runtime.sendMessage({
				type: "UPDATE_JOB_PROGRESS",
				jobId,
				progress,
			});

			if (!response?.success) {
				persistentLogger.error(
					`❌ Failed to update job progress via message: ${jobId}`,
					{
						error: response?.error || "Unknown error",
						progress,
					},
					"offscreen",
				);
			}
		} catch (error) {
			persistentLogger.error(
				`❌ Failed to send job progress update: ${jobId}`,
				error,
				"offscreen",
			);
		}
	}

	// Helper method to complete job via jobNotificationChannel
	private async completeJobViaMessage(
		jobId: string,
		result: JobResult,
	): Promise<void> {
		try {
			// Send completion via jobNotificationChannel to background context
			jobNotificationChannel.notifyJobCompleted(jobId, result, "all");
		} catch (error) {
			persistentLogger.error(
				`❌ Failed to send job completion: ${jobId}`,
				error,
				"offscreen",
			);
		}
	}

	// Simple status indicator for debugging
	private updateStatus(message: string): void {
		// NONE
	}

	// Report current progress to UI thread
	reportProgress(): void {
		console.log("📤 Sending INITIAL_PROGRESS:", this.currentProgress);
		try {
			chrome.runtime?.sendMessage?.({
				type: "INITIAL_PROGRESS",
				currentProgress: this.currentProgress,
			});
			console.log("✅ INITIAL_PROGRESS message sent successfully");
		} catch (error) {
			console.error("❌ Failed to send INITIAL_PROGRESS:", error);
		}
	}

	// Helper method to send chrome messages
	private async sendChromeMessage(message: ChromeMessage): Promise<void> {
		try {
			await chrome.runtime.sendMessage(message);
		} catch (_) {
			// Ignore chrome message errors
		}
	}
}

// Initialize the offscreen processor
if (!offscreenGlobal.__memorallOffscreenSetupDone__) {
	console.log("🚀 OFFSCREEN HTML LOADED!");
	try {
		const statusEl = document.getElementById("status");
		if (statusEl) {
			statusEl.textContent = "OFFSCREEN: HTML Loaded!";
			(statusEl as HTMLElement).style.display = "block";
		}
	} catch (_) {}

	console.log("🚀 Offscreen document script loading...");
	offscreenGlobal.__memorallOffscreenSetupDone__ = true;

	if (!offscreenGlobal.__memorallOffscreenStartLogged__) {
		offscreenGlobal.__memorallOffscreenStartLogged__ = true;
		void (async () => {
			try {
				await persistentLogger.initialize();
				persistentLogger.info(
					"🚀 Offscreen document script started",
					{ timestamp: new Date().toISOString() },
					"offscreen",
				);
			} catch (error) {
				console.warn(
					"Failed to initialize persistentLogger for offscreen start log:",
					error,
				);
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
		console.log("✅ Basic message listener registered for PING");
	} catch (error) {
		console.warn("Failed to add message listener:", error);
	}

	// Keep the offscreen document alive
	setInterval(() => {
		// This prevents the offscreen document from being terminated
		console.log("Offscreen document heartbeat");
	}, 30000); // Every 30 seconds
}

if (!offscreenGlobal.__memorallOffscreenProcessor__) {
	offscreenGlobal.__memorallOffscreenProcessor__ = new OffscreenProcessor();
} else {
	console.info(
		"♻️ OffscreenProcessor already initialized; reusing existing instance.",
	);
}
