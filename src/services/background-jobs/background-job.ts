import { jobNotificationChannel } from "./job-notification-channel";
import { IdbJobStore } from "./idb-job-store";
import { logInfo, logError } from "@/utils/logger";
import type { RememberSavePayload } from "./offscreen-handlers/process-remember-save";
import type { KnowledgeGraphPayload } from "./offscreen-handlers/process-knowledge-graph";
import type { TextToVectorPayload } from "./offscreen-handlers/process-text-to-vector";
import type { TextsToVectorsPayload } from "./offscreen-handlers/process-texts-to-vectors";
import type { BaseJob } from "./offscreen-handlers/types";
export type { BaseJob };

export interface JobQueueState {
	jobs: Record<string, BaseJob>;
}

export interface JobProgressEvent {
	stage: string;
	progress: number;
	status: string;
	error?: string;
	completedAt?: Date;
	[key: string]: unknown;
}

export interface JobStreamResult {
	jobId: string;
	stream: AsyncIterable<JobProgressEvent>;
}

export interface JobPromiseResult {
	jobId: string;
	promise: Promise<{
		success: boolean;
		error?: string;
		data?: Record<string, unknown>;
	}>;
}

export interface JobOptions {
	stream: boolean;
}

// Job type mapping for type safety
type JobTypeMap = {
	"remember-save": RememberSavePayload;
	"knowledge-graph": KnowledgeGraphPayload;
	"restore-local-services": Record<string, never>; // No payload needed
	"text-to-vector": TextToVectorPayload;
	"texts-to-vectors": TextsToVectorsPayload;
};

type JobTypeName = keyof JobTypeMap;

// Job configuration mapping
const JOB_CONFIG = {
	"remember-save": {
		jobType: "remember-save" as const,
		idPrefix: "save" as const,
	},
	"knowledge-graph": {
		jobType: "knowledge-graph-conversion" as const,
		idPrefix: "kg" as const,
	},
	"restore-local-services": {
		jobType: "restore-local-services" as const,
		idPrefix: "restore" as const,
	},
	"text-to-vector": {
		jobType: "text-to-vector" as const,
		idPrefix: "ttv" as const,
	},
	"texts-to-vectors": {
		jobType: "texts-to-vectors" as const,
		idPrefix: "ttvs" as const,
	},
} as const;

export class BackgroundJob {
	private static instance: BackgroundJob;
	private listeners = new Set<(state: JobQueueState) => void>();
	private jobCompletionListeners = new Map<
		string,
		(result: {
			success: boolean;
			error?: string;
			data?: Record<string, unknown>;
		}) => void
	>();
	private jobProgressStreams = new Map<
		string,
		{
			controller: ReadableStreamDefaultController<JobProgressEvent>;
			stream: ReadableStream<JobProgressEvent>;
		}
	>();
	private store = new IdbJobStore();

	private constructor() {
		// Initialize immediate notification system
		logInfo("🚀 Initializing streaming job notification system");
	}

	static getInstance(): BackgroundJob {
		if (!BackgroundJob.instance) {
			BackgroundJob.instance = new BackgroundJob();
		}
		return BackgroundJob.instance;
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

	/**
	 * Subscribe to job completion events
	 */
	subscribeToJobCompletion(
		jobId: string,
		callback: (result: {
			success: boolean;
			error?: string;
			data?: Record<string, unknown>;
		}) => void,
	): void {
		this.jobCompletionListeners.set(jobId, callback);
	}

	private async notifyListeners(): Promise<void> {
		const state = await this.getState();
		this.listeners.forEach((l) => l(state));
	}

	/**
	 * Generic type-safe job creation with streaming or promise-based progress tracking
	 */
	createJob<T extends JobTypeName>(
		jobType: T,
		payload: JobTypeMap[T],
		options: { stream: true },
	): Promise<JobStreamResult>;
	createJob<T extends JobTypeName>(
		jobType: T,
		payload: JobTypeMap[T],
		options: { stream: false },
	): Promise<JobPromiseResult>;
	createJob<T extends JobTypeName>(
		jobType: T,
		payload: JobTypeMap[T],
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult>;
	async createJob<T extends JobTypeName>(
		jobType: T,
		payload: JobTypeMap[T],
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult> {
		// Generic job creation - no business logic, just message passing
		const config = JOB_CONFIG[jobType];
		const jobId = `${config.idPrefix}-${Date.now()}`;

		const job: BaseJob = {
			id: jobId,
			jobType: config.jobType,
			status: "pending",
			payload,
			createdAt: new Date(),
		};

		await this.saveJob(job);
		await this.notifyListeners();

		// Immediate notification via BroadcastChannel (0-50ms latency)
		jobNotificationChannel.notifyJobEnqueued(job);

		logInfo(`📋 Queued ${jobType} job: ${jobId}`);

		if (options.stream) {
			// Create progress stream
			const stream = this.createJobProgressStream(jobId);
			return { jobId, stream };
		} else {
			// Create promise that resolves on completion
			const promise = new Promise<{
				success: boolean;
				error?: string;
				data?: Record<string, unknown>;
			}>((resolve) => {
				this.subscribeToJobCompletion(jobId, resolve);
			});
			return { jobId, promise };
		}
	}

	/**
	 * Execute job immediately without queue (for fast operations)
	 */
	async execute<T extends JobTypeName>(
		jobType: T,
		payload: JobTypeMap[T],
	): Promise<{
		success: boolean;
		error?: string;
		data?: Record<string, unknown>;
	}> {
		const config = JOB_CONFIG[jobType];
		const jobId = `${config.idPrefix}-immediate-${Date.now()}`;

		const job: BaseJob = {
			id: jobId,
			jobType: config.jobType,
			status: "pending",
			payload,
			createdAt: new Date(),
		};

		// Immediate notification via BroadcastChannel for fast processing
		jobNotificationChannel.notifyJobEnqueued(job);

		logInfo(`⚡ Executing immediate ${jobType} job: ${jobId}`);

		// Return a promise that resolves when job completes
		return new Promise<{
			success: boolean;
			error?: string;
			data?: Record<string, unknown>;
		}>((resolve) => {
			this.subscribeToJobCompletion(jobId, (result) => {
				resolve(result);
			});
		});
	}

	/**
	 * Get initialization status and progress stream
	 * Returns current offscreen status and progress updates
	 */
	async initializeServices(): Promise<
		AsyncIterable<{ stage: string; progress: number; status: string }>
	> {
		// Create a stream for initialization progress
		let controller!: ReadableStreamDefaultController<{
			stage: string;
			progress: number;
			status: string;
		}>;
		const stream = new ReadableStream<{
			stage: string;
			progress: number;
			status: string;
		}>({
			start(ctrl) {
				controller = ctrl;
			},
		});

		// Check if offscreen is already initialized by testing a simple message
		const checkOffscreenStatus = async (): Promise<boolean> => {
			try {
				if (typeof chrome === "undefined" || !chrome.runtime) {
					return false;
				}

				// Try to send a test message to see if offscreen is responsive
				const response = await chrome.runtime.sendMessage({
					type: "PING_OFFSCREEN",
				});
				return response === true;
			} catch (error) {
				return false;
			}
		};

		// Set up message listener for offscreen ready and progress updates
		const messageListener = (message: any) => {
			if (message.type === "OFFSCREEN_READY") {
				controller.enqueue({
					stage: "Services ready",
					progress: 100,
					status: "completed",
				});
				controller.close();
				chrome.runtime?.onMessage.removeListener(messageListener);
			}
		};

		try {
			const isAlreadyReady = await checkOffscreenStatus();

			if (isAlreadyReady) {
				// Offscreen is already initialized, immediately report completion
				logInfo("✅ Offscreen already initialized");
				controller.enqueue({
					stage: "Services already ready",
					progress: 100,
					status: "completed",
				});
				controller.close();
			} else {
				// Offscreen not ready, listen for initialization completion
				logInfo("🚀 Waiting for offscreen initialization...");
				chrome.runtime?.onMessage.addListener(messageListener);

				// Start with initial progress
				controller.enqueue({
					stage: "Initializing services...",
					progress: 10,
					status: "initializing",
				});
			}
		} catch (error) {
			// If chrome API not available, simulate completion
			logInfo("🔧 Chrome API not available, simulating completion");
			setTimeout(() => {
				controller.enqueue({
					stage: "Services initialized",
					progress: 100,
					status: "completed",
				});
				controller.close();
			}, 1000);
		}

		// Convert ReadableStream to AsyncIterable
		return {
			async *[Symbol.asyncIterator]() {
				const reader = stream.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						yield value;
					}
				} finally {
					reader.releaseLock();
				}
			},
		};
	}

	/**
	 * Create an async iterable stream for job progress updates
	 */
	private createJobProgressStream(
		jobId: string,
	): AsyncIterable<JobProgressEvent> {
		let controller: ReadableStreamDefaultController<JobProgressEvent>;

		const stream = new ReadableStream<JobProgressEvent>({
			start(ctrl) {
				controller = ctrl;
			},
		});

		// Store the controller for progress updates
		this.jobProgressStreams.set(jobId, { controller: controller!, stream });

		// Convert ReadableStream to AsyncIterable
		return {
			async *[Symbol.asyncIterator]() {
				const reader = stream.getReader();
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						yield value;
					}
				} finally {
					reader.releaseLock();
				}
			},
		};
	}

	async updateJobProgress(
		jobId: string,
		progress: Record<string, unknown>,
	): Promise<void> {
		const job = await this.getJob(jobId);
		if (!job) return;
		const currentProgress = (job.progress as Record<string, unknown>) || {};
		job.progress = { ...currentProgress, ...progress };
		await this.saveJob(job);
		await this.notifyListeners();

		// Notify progress stream if exists
		const streamData = this.jobProgressStreams.get(jobId);
		if (streamData) {
			streamData.controller.enqueue(progress as JobProgressEvent);
		}

		// Immediate notification for progress updates
		jobNotificationChannel.notifyJobUpdated(jobId, job);
	}

	async completeJob(
		jobId: string,
		result: {
			success: boolean;
			error?: string;
			data?: Record<string, unknown>;
		},
	): Promise<void> {
		const job = await this.getJob(jobId);
		if (!job) return;

		// Close progress stream if exists
		const streamData = this.jobProgressStreams.get(jobId);
		if (streamData) {
			streamData.controller.close();
			this.jobProgressStreams.delete(jobId);
		}

		// Notify completion listener if exists
		const completionListener = this.jobCompletionListeners.get(jobId);
		if (completionListener) {
			completionListener(result);
			this.jobCompletionListeners.delete(jobId);
		}

		// Immediate notification for job completion
		jobNotificationChannel.notifyJobCompleted(jobId);

		// Remove completed job from queue
		await this.store.delete(jobId);
		await this.notifyListeners();

		logInfo(
			`📋 Job ${result.success ? "completed" : "failed"} and removed: ${jobId}`,
		);
	}

	async clearCompletedJobs(): Promise<void> {
		await this.store.clearCompleted();
		await this.notifyListeners();

		// Immediate notification for queue cleanup
		jobNotificationChannel.notifyQueueUpdated();

		logInfo("📋 Cleared completed/failed jobs");
	}

	async getJob(jobId: string): Promise<BaseJob | null> {
		return await this.store.get(jobId);
	}

	async getAllJobs(): Promise<BaseJob[]> {
		return await this.store.getAll();
	}

	private async getState(): Promise<JobQueueState> {
		try {
			const all = await this.store.getAll();
			const jobs: Record<string, BaseJob> = {};
			for (const j of all) jobs[j.id] = j;
			return { jobs };
		} catch (e) {
			logError("Failed to load job queue state:", e);
			return { jobs: {} };
		}
	}

	private async saveJob(job: BaseJob): Promise<void> {
		// Normalize date fields while preserving flexible structure
		let normalizedProgress = job.progress;
		if (job.progress) {
			normalizedProgress = { ...(job.progress as Record<string, unknown>) };
			const progress = normalizedProgress as Record<string, unknown>;
			// Normalize common date fields if they exist
			if (progress.startedAt) {
				progress.startedAt = new Date(progress.startedAt as Date);
			}
			if (progress.completedAt) {
				progress.completedAt = new Date(progress.completedAt as Date);
			}
		}

		const norm: BaseJob = {
			...job,
			createdAt: new Date(job.createdAt as Date),
			startedAt: job.startedAt ? new Date(job.startedAt as Date) : undefined,
			completedAt: job.completedAt
				? new Date(job.completedAt as Date)
				: undefined,
			progress: normalizedProgress,
		};
		await this.store.put(norm);
	}
}

export const backgroundJob = BackgroundJob.getInstance();
