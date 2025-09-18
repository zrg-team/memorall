// Offscreen document for background knowledge graph processing
// This runs in a hidden document with full DOM access for LLM/Embedding services
import { logError, logInfo } from "@/utils/logger";
import { ProcessFactory } from "@/services/background-jobs/offscreen-handlers/process-factory";
import { jobNotificationChannel } from "@/services/background-jobs/job-notification-channel";
import type { JobNotificationMessage } from "@/services/background-jobs/job-notification-channel";
import type { BaseJob } from "@/services/background-jobs/offscreen-handlers/types";

// Import process handlers and factory
import type { ProcessDependencies } from "@/services/background-jobs/offscreen-handlers/types";
import type {
	JobProgressUpdate,
	ChromeMessage,
} from "@/services/background-jobs/offscreen-handlers/types";

import { serviceManager } from "@/services";
import { flowsService } from "@/services/flows/flows-service";
import { sharedStorageService } from "@/services/shared-storage";
import type { RememberedContent } from "@/services/database/db";
import { persistentLogger } from "@/services/logging/persistent-logger";

class OffscreenProcessor {
	private initialized = false;
	private activeJobs = new Map<
		string,
		{ pageData: RememberedContent; startTime: number }
	>();
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
		this.processFactory = new ProcessFactory(this.dependencies);
		this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.updateStatus("Initializing...");
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
			await sharedStorageService.initialize();
			persistentLogger.info(
				"✅ SharedStorageService initialized",
				{},
				"offscreen",
			);

			// Initialize all services via ServiceManager (centralized)
			// Wait for DOM ready before initializing services that require DOM access
			persistentLogger.info(
				"🔄 Initializing all services via ServiceManager...",
				{},
				"offscreen",
			);
			await serviceManager.initialize();
			persistentLogger.info(
				"✅ All services initialized via ServiceManager",
				{},
				"offscreen",
			);

			try {
				persistentLogger.info(
					"🔄 Initializing Embedding service...",
					{},
					"offscreen",
				);
				// Warm up by requesting a tiny vector; this triggers ensureDefault()
				await serviceManager.embeddingService.textToVector("warmup");
				persistentLogger.info(
					"✅ Embedding service initialized",
					{},
					"offscreen",
				);
			} catch (embedErr) {
				logError("Failed to initialize embedding service:", embedErr);
				persistentLogger.warn(
					"⚠️ Embedding service initialization failed; continuing",
					embedErr instanceof Error ? embedErr.message : String(embedErr),
					"offscreen",
				);
			}

			persistentLogger.info(
				"🔄 Initializing flows service...",
				{},
				"offscreen",
			);
			await flowsService.initialize();
			persistentLogger.info("✅ Flows service initialized", {}, "offscreen");

			this.initialized = true;
			this.updateStatus("Ready");
			persistentLogger.info(
				"🎉 All services initialized - ready for background processing",
				{},
				"offscreen",
			);

			// Notify background that offscreen is ready so creation wait resolves
			try {
				chrome.runtime?.sendMessage?.({ type: "OFFSCREEN_READY" });
			} catch (_) {}

			// Begin processing queue
			await this.startQueueProcessing();
			persistentLogger.info(
				"✅ Job queue processing loop started",
				{},
				"offscreen",
			);
		} catch (error) {
			logError("Failed to initialize offscreen processor:", error);
			this.updateStatus("Failed");
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
			// Use jobNotificationChannel like background-job.ts
			jobNotificationChannel.subscribe(
				"*",
				async (message: JobNotificationMessage) => {
					if (message.type === "JOB_ENQUEUED") {
						// FAST: Direct processing
						await processFastMessage(message);
					} else {
						// QUEUE: Trigger queue processing for other message types
						void processQueueJobs();
					}
				},
			);

			logInfo("🎧 JobNotificationChannel handler registered", {});
		} catch (err) {
			logError("❌ Failed to register message handlers", err);
		}
	}

	private async processClaimedJob(job: BaseJob): Promise<void> {
		// SINGLE UNIFIED HANDLER - handlers deal with their own payload logic
		const handler = this.processFactory.createUnifiedHandler(job.jobType);
		await handler.process(job.id, job as unknown as BaseJob, this.dependencies);
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

	// Helper method to complete job via background script message
	private async completeJobViaMessage(
		jobId: string,
		result: { success: boolean; error?: string },
	): Promise<void> {
		try {
			const response = await chrome.runtime.sendMessage({
				type: "COMPLETE_JOB",
				jobId,
				result,
			});

			if (!response?.success) {
				persistentLogger.error(
					`❌ Failed to complete job via message: ${jobId}`,
					{
						error: response?.error || "Unknown error",
						result,
					},
					"offscreen",
				);
			}
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
		const statusEl = document.getElementById("status");
		if (statusEl) {
			statusEl.textContent = `OFFSCREEN: ${message}`;
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
console.log("🚀 OFFSCREEN HTML LOADED!");
try {
	const statusEl = document.getElementById("status");
	if (statusEl) {
		statusEl.textContent = "OFFSCREEN: HTML Loaded!";
		(statusEl as HTMLElement).style.display = "block";
	}
} catch (_) {}

console.log("🚀 Offscreen document script loading...");
persistentLogger.info(
	"🚀 Offscreen document script started",
	{ timestamp: new Date().toISOString() },
	"offscreen",
);

new OffscreenProcessor();

// Add message listener for ping/status checks
try {
	chrome.runtime?.onMessage.addListener((message, _sender, sendResponse) => {
		if (message.type === "PING_OFFSCREEN") {
			sendResponse(true);
			return true;
		}
	});
} catch (error) {
	console.warn("Failed to add message listener:", error);
}

// Keep the offscreen document alive
setInterval(() => {
	// This prevents the offscreen document from being terminated
	console.log("Offscreen document heartbeat");
}, 30000); // Every 30 seconds
