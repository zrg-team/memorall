// Offscreen document for background knowledge graph processing
// This runs in a hidden document with full DOM access for LLM/Embedding services

import { logError } from "../src/utils/logger";
import { persistentLogger } from "../src/services/logging/persistent-logger";
import { serviceManager } from "../src/services/ServiceManager";
import { llmService } from "../src/services/llm/llm-service";
import { flowsService } from "../src/services/flows/flows-service";
import { knowledgeGraphService } from "../src/services/knowledge-graph/knowledge-graph-service";
import { embeddingService } from "../src/services/embedding/embedding-service";
import { sharedStorageService } from "../src/services/shared-storage";
import type { RememberedContent } from "../src/services/database/db";
import {
	backgroundJobQueue,
	type BackgroundJob,
} from "../src/services/background-jobs/background-job-queue";
import {
	rememberService,
	type SaveContentData,
	type SavePageData,
} from "../src/services/remember/remember-service";
import { eq } from "drizzle-orm";
import { databaseService } from "@/services/database";

// Jobs are persisted in IndexedDB and coordinated via runtime messages with the background script

class OffscreenProcessor {
	private initialized = false;
	private activeJobs = new Map<
		string,
		{ pageData: RememberedContent; startTime: number }
	>();
	private ticking = false;
	private tickRequested = false;

	constructor() {
		this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.updateStatus("Initializing...");
			await persistentLogger.info(
				"🚀 Starting offscreen processor initialization",
				{},
				"offscreen",
			);

			// Initialize shared storage service first
			await persistentLogger.info(
				"🔄 Initializing SharedStorageService...",
				{},
				"offscreen",
			);
			await sharedStorageService.initialize();
			await persistentLogger.info(
				"✅ SharedStorageService initialized",
				{},
				"offscreen",
			);

			// Initialize all services via ServiceManager (centralized)
			await persistentLogger.info(
				"🔄 Initializing all services via ServiceManager...",
				{},
				"offscreen",
			);
			await serviceManager.initialize();
			await persistentLogger.info(
				"✅ All services initialized via ServiceManager",
				{},
				"offscreen",
			);

			// DEBUG: Log what services are actually available (LLM already initialized via ServiceManager)
			const availableServices = llmService.list();
			await persistentLogger.info(
				"🔍 DEBUG: Available LLM services in offscreen:",
				{ availableServices },
				"offscreen",
			);

			// DEBUG: Log current model in offscreen context
			const currentModel = await llmService.getCurrentModel();
			await persistentLogger.info(
				"🔍 DEBUG: Current model in offscreen:",
				{ currentModel },
				"offscreen",
			);

			// Initialize Embedding service (ensure default embedding is ready)
			try {
				await persistentLogger.info(
					"🔄 Initializing Embedding service...",
					{},
					"offscreen",
				);
				// Warm up by requesting a tiny vector; this triggers ensureDefault()
				await embeddingService.textToVector("warmup");
				await persistentLogger.info(
					"✅ Embedding service initialized",
					{},
					"offscreen",
				);
			} catch (embedErr) {
				logError("Failed to initialize embedding service:", embedErr);
				await persistentLogger.warn(
					"⚠️ Embedding service initialization failed; continuing",
					embedErr instanceof Error ? embedErr.message : String(embedErr),
					"offscreen",
				);
			}

			await persistentLogger.info(
				"🔄 Initializing flows service...",
				{},
				"offscreen",
			);
			await flowsService.initialize();
			await persistentLogger.info(
				"✅ Flows service initialized",
				{},
				"offscreen",
			);

			this.initialized = true;
			this.updateStatus("Ready");
			await persistentLogger.info(
				"🎉 All services initialized - ready for background processing",
				{},
				"offscreen",
			);

			// Notify background that offscreen is ready so creation wait resolves
			try {
				chrome.runtime?.sendMessage?.({ type: "OFFSCREEN_READY" });
			} catch (_) {}

			// Begin processing queue
			await persistentLogger.info(
				"🚀 Starting job queue processing loop",
				{},
				"offscreen",
			);
			this.startQueueProcessing();
			await persistentLogger.info(
				"✅ Job queue processing loop started",
				{},
				"offscreen",
			);
		} catch (error) {
			logError("Failed to initialize offscreen processor:", error);
			this.updateStatus("Failed");
			await persistentLogger.error(
				"❌ Initialization failed",
				error,
				"offscreen",
			);
		}
	}
	private startQueueProcessing(): void {
		const runTick = async () => {
			if (this.ticking) {
				this.tickRequested = true;
				return;
			}
			this.ticking = true;
			try {
				await persistentLogger.info(
					"🧭 Queue tick started",
					{ timestamp: new Date().toISOString() },
					"offscreen",
				);

				// Try to get jobs via background script message instead of direct storage access
				try {
					let jobs: BackgroundJob[] = [];

					// Offscreen documents can't directly access background storage
					// Always use message-based approach
					await persistentLogger.info(
						"📞 Requesting jobs from background script via message",
						{},
						"offscreen",
					);

					const response = await chrome.runtime.sendMessage({
						type: "GET_BACKGROUND_JOBS",
					});

					if (response?.success && response?.jobs) {
						jobs = response.jobs;
						await persistentLogger.info(
							"✅ Background message-based job access succeeded",
							{ count: jobs.length },
							"offscreen",
						);
					} else {
						throw new Error(
							`Background job request failed: ${response?.error || "unknown error"}`,
						);
					}

					const pendingJobs = jobs.filter((j) => j.status === "pending");
					const runningJobs = jobs.filter((j) => j.status === "running");
					const completedJobs = jobs.filter((j) => j.status === "completed");

					await persistentLogger.info(
						"📋 Jobs snapshot",
						{
							total: jobs.length,
							pending: pendingJobs.length,
							running: runningJobs.length,
							completed: completedJobs.length,
							pendingIds: pendingJobs.map((j) => j.id),
						},
						"offscreen",
					);

					// Now try to claim and process jobs via message-based approach
					let jobCount = 0;

					for (const pendingJob of pendingJobs) {
						try {
							await persistentLogger.info(
								"🎯 Attempting to claim job via background script",
								{
									jobId: pendingJob.id,
									jobType: pendingJob.jobType,
								},
								"offscreen",
							);

							// Request background script to claim this specific job for us
							const claimResponse = await chrome.runtime.sendMessage({
								type: "CLAIM_JOB_FOR_OFFSCREEN",
								jobId: pendingJob.id,
							});

							if (claimResponse?.success && claimResponse?.job) {
								const claimedJob = claimResponse.job;
								jobCount++;
								await persistentLogger.info(
									"🚚 Claimed job via background script",
									{
										id: claimedJob.id,
										type: claimedJob.jobType,
										jobNumber: jobCount,
										status: claimedJob.status,
									},
									"offscreen",
								);
								await this.processClaimedJob(claimedJob);
							} else {
								await persistentLogger.warn(
									"⚠️ Failed to claim job via background script",
									{
										jobId: pendingJob.id,
										error: claimResponse?.error || "Unknown error",
									},
									"offscreen",
								);
							}
						} catch (claimErr) {
							await persistentLogger.error(
								"❌ Failed to claim job via message",
								{
									error:
										claimErr instanceof Error
											? claimErr.message
											: String(claimErr),
									jobId: pendingJob.id,
								},
								"offscreen",
							);
						}
					}

					if (jobCount === 0 && pendingJobs.length > 0) {
						await persistentLogger.warn(
							"⚠️ No jobs claimed despite pending jobs available",
							{
								pendingCount: pendingJobs.length,
							},
							"offscreen",
						);
					} else if (jobCount === 0) {
						await persistentLogger.debug(
							"👀 No pending jobs found to claim",
							{},
							"offscreen",
						);
					}
				} catch (jobsErr) {
					await persistentLogger.error(
						"❌ Complete job processing failed",
						{
							error:
								jobsErr instanceof Error ? jobsErr.message : String(jobsErr),
							hasChrome: !!globalThis.chrome,
							hasRuntime: !!globalThis.chrome?.runtime,
						},
						"offscreen",
					);
				}
			} catch (e) {
				logError("Queue processing error:", e);
				await persistentLogger.error(
					"❌ Queue processing error",
					e,
					"offscreen",
				);
			} finally {
				this.ticking = false;
				if (this.tickRequested) {
					this.tickRequested = false;
					await persistentLogger.debug(
						"🔄 Restarting tick due to request",
						{},
						"offscreen",
					);
					// Run again if a tick was requested during processing
					void runTick();
				}
			}
		};

		// Initial tick
		persistentLogger.info(
			"🎬 Running initial job processing tick",
			{},
			"offscreen",
		);
		void runTick();

		// Also run an immediate tick after a short delay to catch any jobs that might have been queued during initialization
		setTimeout(async () => {
			await persistentLogger.info(
				"⏰ Running delayed initialization tick",
				{},
				"offscreen",
			);
			void runTick();
		}, 1000);

		// Subscribe to queue changes to trigger ticks
		backgroundJobQueue.subscribe(async () => {
			await persistentLogger.info(
				"🔔 Background job queue subscription triggered, running tick",
				{},
				"offscreen",
			);
			void runTick();
		});

		// Also listen for explicit broadcast from background
		try {
			chrome.runtime.onMessage.addListener(async (msg) => {
				if (msg?.type === "JOB_QUEUE_UPDATED") {
					persistentLogger.info(
						"📢 Received JOB_QUEUE_UPDATED message, triggering tick",
						{},
						"offscreen",
					);
					void runTick();
				} else if (msg?.type === "ENSURE_LLM_SERVICE") {
					// Handle LLM service configuration sync
					try {
						persistentLogger.info(
							`📥 Received ENSURE_LLM_SERVICE: ${msg.serviceName}`,
							msg.config,
							"offscreen",
						);

						// Create/update the service in offscreen context
						if (llmService.has(msg.serviceName)) {
							llmService.remove(msg.serviceName);
						}
						await llmService.create(msg.serviceName, msg.config);

						persistentLogger.info(
							`✅ LLM service ${msg.serviceName} created in offscreen`,
							{},
							"offscreen",
						);
					} catch (error) {
						persistentLogger.error(
							`❌ Failed to create LLM service ${msg.serviceName} in offscreen`,
							error,
							"offscreen",
						);
					}
				}
			});
			persistentLogger.info(
				"🎧 Message listeners registered for JOB_QUEUE_UPDATED and ENSURE_LLM_SERVICE",
				{},
				"offscreen",
			);
		} catch (err) {
			persistentLogger.error(
				"❌ Failed to register message listener",
				err,
				"offscreen",
			);
		}

		// Periodic safety tick
		setInterval(() => void runTick(), 8000);
	}

	private async processClaimedJob(job: BackgroundJob): Promise<void> {
		if (job.jobType === "remember-save") {
			await this.processRememberSave(
				job.id,
				job.payload as SaveContentData | SavePageData,
			);
		} else if (job.jobType === "knowledge-graph-conversion") {
			await this.processKnowledgeGraph(job.id, job.pageData);
		}
	}

	private async processRememberSave(
		jobId: string,
		payload: SaveContentData | SavePageData,
	): Promise<void> {
		try {
			this.updateStatus(
				`Saving: ${(payload as any).title?.substring?.(0, 30) || "content"}...`,
			);
			await persistentLogger.info(
				`💾 Processing save-content job: ${jobId}`,
				{ title: (payload as any).title },
				"offscreen",
			);

			// Initialize remember service on demand
			await this.updateJobProgressViaMessage(jobId, {
				status: "saving_to_database",
				stage: "Initializing services...",
				progress: 10,
			});
			await rememberService.initialize();

			let result;
			await this.updateJobProgressViaMessage(jobId, {
				status: "saving_to_database",
				stage: "Saving content...",
				progress: 30,
			});
			if ((payload as any).html && (payload as any).article) {
				result = await rememberService.savePage(payload as SavePageData);
			} else {
				result = await rememberService.saveContentDirect(
					payload as SaveContentData,
				);
			}

			if (result.success) {
				// Verify persistence by querying DB for the inserted row
				try {
					const rows = await databaseService.use(async ({ db, schema }) => {
						return db
							.select()
							.from(schema.rememberedContent)
							.where(eq(schema.rememberedContent.id, result.pageId!));
					});
					await persistentLogger.info(
						`🗄️ DB verification for job ${jobId}`,
						{
							pageId: result.pageId,
							foundCount: Array.isArray(rows) ? rows.length : 0,
							foundTitle: Array.isArray(rows) && rows[0]?.title,
						},
						"offscreen",
					);
				} catch (verifyErr) {
					await persistentLogger.warn(
						`⚠️ DB verification failed for job ${jobId}`,
						verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
						"offscreen",
					);
				}
				await this.updateJobProgressViaMessage(jobId, {
					status: "saving_to_database",
					stage: "Finalizing...",
					progress: 90,
					pageId: result.pageId || "unknown",
				});
				await this.updateJobProgressViaMessage(jobId, {
					status: "completed",
					stage: "Saved to database",
					progress: 100,
					completedAt: new Date(),
					pageId: result.pageId || "unknown",
				});
				await this.completeJobViaMessage(jobId, { success: true });
				await persistentLogger.info(
					`✅ Save-content job completed: ${jobId}`,
					{ pageId: result.pageId },
					"offscreen",
				);

				// Notify background script about job completion for loading indicator
				try {
					chrome.runtime.sendMessage({ type: "JOB_COMPLETED", jobId });
				} catch (_) {}
			} else {
				await this.updateJobProgressViaMessage(jobId, {
					status: "failed",
					stage: "Failed to save",
					progress: 100,
					completedAt: new Date(),
					error: result.error,
				});
				await this.completeJobViaMessage(jobId, {
					success: false,
					error: result.error,
				});
				await persistentLogger.error(
					`❌ Save-content job failed: ${jobId}`,
					result.error,
					"offscreen",
				);

				// Notify background script about job completion for loading indicator (even for failed jobs)
				try {
					chrome.runtime.sendMessage({ type: "JOB_COMPLETED", jobId });
				} catch (_) {}
			}
		} catch (error) {
			logError(`Save-content job ${jobId} failed:`, error);
			await this.updateJobProgressViaMessage(jobId, {
				status: "failed",
				stage: "Error during save",
				progress: 100,
				completedAt: new Date(),
				error: error instanceof Error ? error.message : String(error),
			});
			await this.completeJobViaMessage(jobId, {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			// Notify background script about job completion for loading indicator (even for failed jobs)
			try {
				chrome.runtime.sendMessage({ type: "JOB_COMPLETED", jobId });
			} catch (_) {}
		}
	}

	private async processKnowledgeGraph(
		jobId: string,
		pageData: RememberedContent,
	): Promise<void> {
		await persistentLogger.info(
			`🔄 Starting knowledge graph job: ${jobId}`,
			{
				pageTitle: pageData.title,
				pageId: pageData.id,
			},
			"offscreen",
		);

		// CRITICAL DEBUG: Check what services and current model we have before processing
		const availableServices = llmService.list();
		const currentModel = await llmService.getCurrentModel();
		await persistentLogger.info(
			"🔍 CRITICAL DEBUG: Before knowledge graph processing:",
			{
				availableServices,
				currentModel,
				hasLmstudio: llmService.has("lmstudio"),
				hasOpenai: llmService.has("openai"),
			},
			"offscreen",
		);

		this.activeJobs.set(jobId, { pageData, startTime: Date.now() });
		this.updateStatus(`Processing: ${pageData.title.substring(0, 30)}...`);

		try {
			// Send initial progress update
			await this.updateJobProgressViaMessage(jobId, {
				status: "extracting_entities",
				stage: "Starting background processing...",
				progress: 5,
			});

			// Subscribe to knowledge graph service progress for detailed logging
			const unsubscribe = knowledgeGraphService.subscribe((conversions) => {
				const conversion = conversions.get(pageData.id);
				if (conversion) {
					this.updateJobProgressViaMessage(jobId, conversion);
					persistentLogger.info(
						`📊 Job ${jobId} progress: ${conversion.stage}`,
						{
							status: conversion.status,
							progress: conversion.progress,
							stage: conversion.stage,
						},
						"offscreen",
					);
				}
			});

			try {
				await persistentLogger.info(
					`🧠 Processing knowledge graph for: ${pageData.title}`,
					{
						jobId,
						pageId: pageData.id,
						contentLength: pageData.textContent.length,
					},
					"offscreen",
				);

				await knowledgeGraphService.convertPageToKnowledgeGraph(pageData);

				await this.completeJobViaMessage(jobId, { success: true });
				await persistentLogger.info(
					`✅ Knowledge graph job completed successfully: ${jobId}`,
					{
						pageTitle: pageData.title,
						duration: Date.now() - this.activeJobs.get(jobId)!.startTime,
					},
					"offscreen",
				);

				// Notify background script about job completion for loading indicator
				try {
					chrome.runtime.sendMessage({ type: "JOB_COMPLETED", jobId });
				} catch (_) {}
			} finally {
				unsubscribe();
			}
		} catch (error) {
			logError(`Job ${jobId} failed:`, error);
			await persistentLogger.error(
				`❌ Knowledge graph job failed: ${jobId}`,
				error,
				"offscreen",
			);
			await this.completeJobViaMessage(jobId, {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});

			// Notify background script about job completion for loading indicator (even for failed jobs)
			try {
				chrome.runtime.sendMessage({ type: "JOB_COMPLETED", jobId });
			} catch (_) {}
		} finally {
			this.activeJobs.delete(jobId);
			this.updateStatus(
				this.activeJobs.size > 0
					? `Processing ${this.activeJobs.size} jobs...`
					: "Ready",
			);
		}
	}

	// Helper method to update job progress via background script message
	private async updateJobProgressViaMessage(
		jobId: string,
		progress: any,
	): Promise<void> {
		try {
			const response = await chrome.runtime.sendMessage({
				type: "UPDATE_JOB_PROGRESS",
				jobId,
				progress,
			});

			if (!response?.success) {
				await persistentLogger.error(
					`❌ Failed to update job progress via message: ${jobId}`,
					{
						error: response?.error || "Unknown error",
						progress,
					},
					"offscreen",
				);
			}
		} catch (error) {
			await persistentLogger.error(
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
				await persistentLogger.error(
					`❌ Failed to complete job via message: ${jobId}`,
					{
						error: response?.error || "Unknown error",
						result,
					},
					"offscreen",
				);
			}
		} catch (error) {
			await persistentLogger.error(
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

// Keep the offscreen document alive
setInterval(() => {
	// This prevents the offscreen document from being terminated
	console.log("Offscreen document heartbeat");
}, 30000); // Every 30 seconds
