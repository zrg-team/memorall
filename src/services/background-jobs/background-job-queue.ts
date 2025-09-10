import { logInfo, logError } from "@/utils/logger";
import type { RememberedContent } from "@/services/database/db";
import type { ConversionProgress } from "@/types/knowledge-graph";
import type {
	SaveContentData,
	SavePageData,
} from "@/services/remember/remember-service";
import { IdbJobStore } from "./idb-job-store";

export type JobType = "remember-save" | "knowledge-graph-conversion";

export interface BackgroundJobBase {
	id: string;
	jobType: JobType;
	status: "pending" | "running" | "completed" | "failed";
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
}

export interface RememberSaveJob extends BackgroundJobBase {
	jobType: "remember-save";
	payload: SaveContentData | SavePageData;
	progress: ConversionProgress;
}

export interface KnowledgeGraphJob extends BackgroundJobBase {
	jobType: "knowledge-graph-conversion";
	pageId: string;
	pageData: RememberedContent;
	progress: ConversionProgress;
}

export type BackgroundJob = RememberSaveJob | KnowledgeGraphJob;

export interface JobQueueState {
	jobs: Record<string, BackgroundJob>;
}

export class BackgroundJobQueue {
	private static instance: BackgroundJobQueue;
	private listeners = new Set<(state: JobQueueState) => void>();
	private store = new IdbJobStore();

	private constructor() {
		try {
			chrome.runtime?.onMessage?.addListener((msg) => {
				if (msg?.type === "JOB_QUEUE_UPDATED") {
					void this.notifyListeners();
				}
			});
		} catch (_) {}
	}

	static getInstance(): BackgroundJobQueue {
		if (!BackgroundJobQueue.instance) {
			BackgroundJobQueue.instance = new BackgroundJobQueue();
		}
		return BackgroundJobQueue.instance;
	}

	async initialize(): Promise<void> {
		// Warm up IndexedDB
		await this.getAllJobs();
		logInfo("📋 Background job queue ready (IndexedDB)");
	}

	subscribe(listener: (state: JobQueueState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private async notifyListeners(): Promise<void> {
		const state = await this.getState();
		this.listeners.forEach((l) => l(state));
	}

	async addRememberSaveJob(
		payload: SaveContentData | SavePageData,
	): Promise<string> {
		const kind = (payload as any).sourceType || "webpage";
		const jobId = `save-${kind}-${Date.now()}`;

		logInfo(`🆕 Creating remember save job: ${jobId}`, {
			title: payload.title,
			kind,
			payloadKeys: Object.keys(payload),
		});

		const job: RememberSaveJob = {
			id: jobId,
			jobType: "remember-save",
			status: "pending",
			createdAt: new Date(),
			payload,
			progress: {
				pageId: "pending",
				pageTitle: payload.title,
				pageUrl:
					(payload as any).sourceUrl ||
					(payload as any).originalUrl ||
					"unknown",
				status: "pending",
				stage: "Queued",
				progress: 0,
				startedAt: new Date(),
			},
		};

		await this.saveJob(job);
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
		logInfo(`📋 Queued save job: ${jobId} - job saved to storage successfully`);

		// Verify the job was actually saved
		const savedJob = await this.getJob(jobId);
		if (savedJob) {
			logInfo(`✅ Job verification successful: ${jobId} found in storage`);
		} else {
			logError(
				`❌ Job verification failed: ${jobId} not found in storage after save`,
			);
		}

		return jobId;
	}

	async addKnowledgeGraphJob(pageData: RememberedContent): Promise<string> {
		const jobId = `kg-${pageData.id}-${Date.now()}`;
		const job: KnowledgeGraphJob = {
			id: jobId,
			jobType: "knowledge-graph-conversion",
			pageId: pageData.id,
			pageData,
			status: "pending",
			createdAt: new Date(),
			progress: {
				pageId: pageData.id,
				pageTitle: pageData.title,
				pageUrl: this.getContentUrl(pageData),
				status: "pending",
				stage: "Queued",
				progress: 0,
				startedAt: new Date(),
			},
		};
		await this.saveJob(job);
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
		logInfo(`📋 Queued KG job: ${jobId}`);
		return jobId;
	}

	async claimNextPendingJob(): Promise<BackgroundJob | null> {
		logInfo("🔍 Attempting to claim next pending job...");
		const allJobs = await this.getAllJobs();
		logInfo(`📊 Job queue state: ${allJobs.length} total jobs`);
		const pendingJobs = allJobs.filter((j) => j.status === "pending");
		const runningJobs = allJobs.filter((j) => j.status === "running");
		const completedJobs = allJobs.filter((j) => j.status === "completed");

		logInfo(
			`📋 Job status breakdown: ${pendingJobs.length} pending, ${runningJobs.length} running, ${completedJobs.length} completed`,
		);

		if (pendingJobs.length > 0) {
			logInfo(
				`🎯 Pending jobs found:`,
				pendingJobs.map((j) => ({
					id: j.id,
					type: j.jobType,
					created: j.createdAt,
				})),
			);
		}

		const pending = pendingJobs[0];
		if (!pending) {
			logInfo("❌ No pending jobs found to claim");
			return null;
		}

		logInfo(`🚀 Claiming job: ${pending.id} (${pending.jobType})`);
		pending.status = "running";
		pending.startedAt = new Date();
		pending.progress.status = "extracting_entities";
		pending.progress.stage =
			pending.jobType === "remember-save"
				? "Saving content..."
				: "Starting conversion...";
		pending.progress.progress = 5;
		await this.saveJob(pending);
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
		logInfo(`✅ Job claimed successfully: ${pending.id}`);
		return pending;
	}

	async updateJobProgress(
		jobId: string,
		progress: Partial<ConversionProgress>,
	): Promise<void> {
		const job = await this.getJob(jobId);
		if (!job) return;
		job.progress = { ...job.progress, ...progress } as ConversionProgress;
		await this.saveJob(job);
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
	}

	async completeJob(
		jobId: string,
		result: { success: boolean; error?: string },
	): Promise<void> {
		const job = await this.getJob(jobId);
		if (!job) return;
		job.status = result.success ? "completed" : "failed";
		job.completedAt = new Date();
		job.error = result.error;
		job.progress.status = result.success ? "completed" : "failed";
		job.progress.stage = result.success ? "Completed successfully" : "Failed";
		job.progress.progress = 100;
		job.progress.completedAt = new Date();
		if (!result.success) job.progress.error = result.error;
		await this.saveJob(job);
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
		logInfo(`📋 Job ${result.success ? "completed" : "failed"}: ${jobId}`);
	}

	async clearCompletedJobs(): Promise<void> {
		await this.store.clearCompleted();
		await this.notifyListeners();
		try {
			chrome.runtime?.sendMessage?.({ type: "JOB_QUEUE_UPDATED" });
		} catch (_) {}
		logInfo("📋 Cleared completed/failed jobs");
	}

	async getJob(jobId: string): Promise<BackgroundJob | null> {
		return await this.store.get(jobId);
	}

	async getAllJobs(): Promise<BackgroundJob[]> {
		return await this.store.getAll();
	}

	private async getState(): Promise<JobQueueState> {
		try {
			const all = await this.store.getAll();
			const jobs: Record<string, BackgroundJob> = {};
			for (const j of all) jobs[j.id] = j;
			return { jobs };
		} catch (e) {
			logError("Failed to load job queue state:", e);
			return { jobs: {} };
		}
	}

	private async saveJob(job: BackgroundJob): Promise<void> {
		// Normalize date fields to primitives before storing
		const normalizedProgress: ConversionProgress = {
			...job.progress,
			// Ensure required field remains a Date (never undefined)
			startedAt: new Date(job.progress.startedAt ?? new Date()),
			completedAt: job.progress.completedAt
				? new Date(job.progress.completedAt)
				: undefined,
		};

		const norm: BackgroundJob = {
			...job,
			createdAt: new Date(job.createdAt),
			startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
			completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
			progress: normalizedProgress,
		};
		await this.store.put(norm);
	}

	private getContentUrl(content: RememberedContent): string {
		if (content.sourceUrl) return content.sourceUrl;
		if (content.originalUrl) return content.originalUrl;
		return `content://${content.id}`;
	}
}

export const backgroundJobQueue = BackgroundJobQueue.getInstance();
