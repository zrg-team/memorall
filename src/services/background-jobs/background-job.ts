import { defaultJobNotificationBridge } from "./bridges/factory";
import type {
	IJobNotificationBridge,
	JobNotificationMessage,
} from "./bridges/types";
import { IdbJobStore } from "./idb-job-store";
import { logInfo, logError } from "@/utils/logger";
import { v4 as nanoid } from "@/utils/uuid";
import type {
	BaseJob,
	JobProgressEvent,
	JobProgressUpdate,
	JobResult,
	JobResultFor,
	JobStatus,
} from "./offscreen-handlers/types";
export type { BaseJob };

export interface JobQueueState {
	jobs: Record<string, BaseJob>;
}

export interface JobStreamResult {
	jobId: string;
	stream: AsyncIterable<JobProgressEvent>;
}

export interface JobPromiseResult<
	T extends keyof JobResultRegistry = keyof JobResultRegistry,
> {
	jobId: string;
	promise: Promise<JobResultFor<T>>;
}

export interface JobOptions {
	stream: boolean;
}

// Smart type inference using global JobTypeRegistry
// Handlers extend the global interface to register their types
// This provides perfect IntelliSense for job types and payload structures

export class BackgroundJob {
	private static instance: BackgroundJob;
	private listeners = new Set<(state: JobQueueState) => void>();
	private jobCompletionListeners = new Map<
		string,
		(result: JobResult) => void
	>();
	private jobProgressStreams = new Map<
		string,
		{
			controller: ReadableStreamDefaultController<JobProgressEvent>;
			stream: ReadableStream<JobProgressEvent>;
		}
	>();
	private jobProgressListeners = new Map<string, () => void>();
	private store = new IdbJobStore();
	private notificationBridge: IJobNotificationBridge;

	private constructor() {
		// Use the shared singleton bridge instance across all BackgroundJob instances
		this.notificationBridge = defaultJobNotificationBridge;
		logInfo(
			"🚀 Initializing streaming job notification system with shared bridge",
		);
	}

	static getInstance(): BackgroundJob {
		if (!BackgroundJob.instance) {
			BackgroundJob.instance = new BackgroundJob();
		}
		return BackgroundJob.instance;
	}

	/**
	 * Get the notification bridge instance for direct access
	 * Used by offscreen.ts for job event subscriptions
	 */
	getNotificationBridge(): IJobNotificationBridge {
		return this.notificationBridge;
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
		callback: (result: JobResult) => void,
	): void {
		this.jobCompletionListeners.set(jobId, callback);
	}

	private async notifyListeners(): Promise<void> {
		const state = await this.getState();
		this.listeners.forEach((l) => l(state));
	}

	/**
	 * Create a job with smart payload type inference
	 * TypeScript will suggest the correct payload structure based on jobType
	 *
	 * @example
	 * // TypeScript knows the exact payload structure:
	 * backgroundJob.createJob("basic-async", { message: "hello", delay: 1000 })
	 */
	createJob<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: { stream: true },
	): Promise<JobStreamResult>;
	createJob<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: { stream: false },
	): Promise<JobPromiseResult<T extends keyof JobResultRegistry ? T : never>>;
	createJob<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: JobOptions,
	): Promise<
		| JobStreamResult
		| JobPromiseResult<T extends keyof JobResultRegistry ? T : never>
	>;
	// Fallback for unregistered job types
	createJob(
		jobType: string,
		payload: unknown,
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult>;
	async createJob<T extends keyof JobTypeRegistry>(
		jobType: T | string,
		payload: T extends keyof JobTypeRegistry ? JobTypeRegistry[T] : unknown,
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult> {
		// Generic job creation - completely dynamic, no configuration needed
		const jobId = nanoid();

		const job: BaseJob = {
			id: jobId,
			jobType: jobType,
			status: "pending",
			payload,
			createdAt: new Date(),
			progress: [],
		};

		await this.saveJob(job);
		await this.notifyListeners();

		// Immediate notification via cross-context bridge (0-50ms latency)
		this.notificationBridge.notifyJobEnqueued(job);

		logInfo(`📋 Queued ${jobType} job: ${jobId}`);

		if (options.stream) {
			// Create progress stream
			const stream = this.createJobProgressStream(jobId);
			this.attachProgressForwarder(jobId, true); // createJob uses queue-based completion
			return { jobId, stream };
		} else {
			// Create promise that resolves on completion
			const promise = new Promise<
				JobResultFor<T extends keyof JobResultRegistry ? T : never>
			>((resolve) => {
				this.subscribeToJobCompletion(jobId, resolve as any); // TODO: Fix type system
			});
			return { jobId, promise };
		}
	}

	/**
	 * Execute job immediately with smart payload type inference
	 * TypeScript will suggest the correct payload structure based on jobType
	 *
	 * @example
	 * // TypeScript knows the exact payload structure:
	 * await backgroundJob.execute("basic-async", { message: "hello", delay: 1000 })
	 */
	execute<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: { stream: true },
	): Promise<JobStreamResult>;
	execute<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: { stream: false },
	): Promise<JobPromiseResult<T extends keyof JobResultRegistry ? T : never>>;
	execute<T extends keyof JobTypeRegistry>(
		jobType: T,
		payload: JobTypeRegistry[T],
		options: JobOptions,
	): Promise<
		| JobStreamResult
		| JobPromiseResult<T extends keyof JobResultRegistry ? T : never>
	>;
	// Fallback for unregistered job types
	execute(
		jobType: string,
		payload: unknown,
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult>;
	async execute<T extends keyof JobTypeRegistry>(
		jobType: T | string,
		payload: T extends keyof JobTypeRegistry ? JobTypeRegistry[T] : unknown,
		options: JobOptions,
	): Promise<JobStreamResult | JobPromiseResult> {
		const jobId = nanoid();

		const job: BaseJob = {
			id: jobId,
			jobType: jobType,
			status: "pending",
			payload,
			createdAt: new Date(),
			progress: [],
		};

		// Skip saveJob - send directly to offscreen for immediate processing
		// Immediate notification via cross-context bridge for fast processing
		this.notificationBridge.notifyJobEnqueued(job);

		logInfo(`⚡ Executing immediate ${jobType} job: ${jobId}`);

		if (options.stream) {
			// Create progress stream
			const stream = this.createJobProgressStream(jobId);
			this.attachProgressForwarder(jobId, true); // execute needs direct completion handling
			return { jobId, stream };
		} else {
			// Create promise that resolves on completion - direct notification handling for execute
			const promise = new Promise<
				JobResultFor<T extends keyof JobResultRegistry ? T : never>
			>((resolve, reject) => {
				// Listen directly for job completion notifications since execute doesn't use queue
				const unsubscribe = this.notificationBridge.subscribe(
					"JOB_COMPLETED",
					(message: JobNotificationMessage) => {
						if (message.jobId === jobId) {
							unsubscribe();
							if (message.result) {
								resolve(
									message.result as JobResultFor<
										T extends keyof JobResultRegistry ? T : never
									>,
								);
							} else {
								reject(new Error("Job completed without result"));
							}
						}
					},
				);
			});
			return { jobId, promise };
		}
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

		// Set up message listener for initialization progress updates
		const messageListener = (message: any) => {
			if (message.type === "INITIAL_PROGRESS") {
				// Forward currentProgress from offscreen
				controller.enqueue({
					stage: message.currentProgress?.status || "Initializing...",
					progress: message.currentProgress?.progress || 0,
					status: message.currentProgress?.done ? "completed" : "initializing",
				});

				// Complete when done
				if (message.currentProgress?.done) {
					controller.close();
					chrome.runtime?.onMessage.removeListener(messageListener);
				}
			}
		};

		try {
			// Check if chrome API is available
			if (typeof chrome !== "undefined" && chrome.runtime) {
				// Listen for progress updates
				chrome.runtime.onMessage.addListener(messageListener);

				// Send INITIAL message to trigger offscreen initialization
				try {
					await chrome.runtime.sendMessage({ type: "INITIAL" });
					logInfo("📋 Sent INITIAL message to offscreen");
				} catch (error) {
					logError("Failed to send INITIAL message:", error);
					controller.enqueue({
						stage: "Failed to initialize",
						progress: 0,
						status: "error",
					});
					controller.close();
				}
			} else {
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
		} catch (error) {
			logError("Failed to initialize services:", error);
			controller.enqueue({
				stage: "Initialization failed",
				progress: 0,
				status: "error",
			});
			controller.close();
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
			start: (ctrl) => {
				controller = ctrl;
			},
			cancel: () => {
				this.cleanupProgressStream(jobId);
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

	private attachProgressForwarder(
		jobId: string,
		handleDirectCompletion: boolean = false,
	): void {
		if (this.jobProgressListeners.has(jobId)) return;

		const localContext = this.notificationBridge.getContextType();

		const listener = this.notificationBridge.subscribe(
			"*",
			(message: JobNotificationMessage) => {
				if (message.jobId !== jobId) return;
				if (message.sender === localContext) return;

				const streamData = this.jobProgressStreams.get(jobId);
				if (!streamData) return;

				switch (message.type) {
					case "JOB_PROGRESS":
						try {
							streamData.controller.enqueue(message.progress);
						} catch (error) {
							logError(
								`Error enqueuing progress event for job ${jobId}`,
								error,
							);
						}
						break;
					case "JOB_COMPLETED":
						if (!handleDirectCompletion) {
							return;
						}
						try {
							streamData.controller.enqueue(
								message.result as unknown as JobProgressEvent,
							);
							streamData.controller.close();
						} catch (error) {
							logError(`Error closing progress stream for job ${jobId}`, error);
						} finally {
							this.cleanupProgressStream(jobId);
						}
						break;
				}
			},
		);

		// Store unsubscribe functions
		this.jobProgressListeners.set(jobId, () => {
			listener();
		});
	}

	private cleanupProgressStream(jobId: string): void {
		const unsubscribe = this.jobProgressListeners.get(jobId);
		if (unsubscribe) {
			unsubscribe();
			this.jobProgressListeners.delete(jobId);
		}
		this.jobProgressStreams.delete(jobId);
	}

	private normalizeProgressEvent(
		job: BaseJob,
		progress: JobProgressUpdate,
	): JobProgressEvent {
		const status: JobStatus =
			progress.status ??
			(job.status === "failed"
				? "failed"
				: progress.progress >= 100
					? "completed"
					: "processing");

		const completedAt =
			progress.completedAt ??
			(status === "completed" || status === "failed"
				? (progress.timestamp ?? job.completedAt ?? new Date())
				: undefined);

		const event: JobProgressEvent = {
			...progress,
			status,
			completedAt,
			error: progress.error ?? job.error,
			timestamp: progress.timestamp ?? new Date(),
		};

		if (event.metadata) {
			event.metadata = { ...event.metadata };
		}

		if (!event.result && progress.result) {
			event.result = progress.result;
		}

		return event;
	}

	async updateJobProgress(
		jobId: string,
		progress: JobProgressUpdate,
	): Promise<void> {
		const job = await this.getJob(jobId);

		// For execute jobs (no job in queue), create a minimal event and send notifications
		if (!job) {
			const event: JobProgressEvent = {
				...progress,
				status: progress.status ?? "processing",
				timestamp: progress.timestamp ?? new Date(),
			};

			// Notify progress stream if exists
			const streamData = this.jobProgressStreams.get(jobId);
			if (streamData) {
				streamData.controller.enqueue(event);
			}

			// Send immediate notification for execute jobs
			this.notificationBridge.notifyJobProgress(jobId, event, "all");
			return;
		}

		const event = this.normalizeProgressEvent(job, progress);

		// Add the new progress update to the array
		if (!job.progress) {
			job.progress = [];
		}
		job.progress.push(event);
		job.status = event.status;

		await this.saveJob(job);
		await this.notifyListeners();

		// Notify progress stream if exists
		const streamData = this.jobProgressStreams.get(jobId);
		if (streamData) {
			streamData.controller.enqueue(event);
		}

		// Immediate notification for progress updates
		this.notificationBridge.notifyJobUpdated(jobId, job);
		if (this.notificationBridge.getContextType() !== "ui") {
			this.notificationBridge.notifyJobProgress(jobId, event, "all");
		}
	}

	async completeJob(jobId: string, result: JobResult): Promise<void> {
		const job = await this.getJob(jobId);
		if (!job) return;

		// Close progress stream if exists
		const streamData = this.jobProgressStreams.get(jobId);
		if (streamData) {
			try {
				streamData.controller.close();
			} catch (error) {
				logError(
					`Error closing progress stream for completed job ${jobId}`,
					error,
				);
			} finally {
				this.cleanupProgressStream(jobId);
			}
		}

		// Notify completion listener if exists
		const completionListener = this.jobCompletionListeners.get(jobId);
		if (completionListener) {
			completionListener(result);
			this.jobCompletionListeners.delete(jobId);
		}

		// Immediate notification for job completion - send to all contexts
		this.notificationBridge.notifyJobCompleted(jobId, result, "all");

		// Remove completed job from queue
		await this.store.delete(jobId);
		await this.notifyListeners();

		logInfo(`📋 Job completed and removed: ${jobId}`);
	}

	async clearCompletedJobs(): Promise<void> {
		await this.store.clearCompleted();
		await this.notifyListeners();

		// Immediate notification for queue cleanup
		this.notificationBridge.notifyQueueUpdated();

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
		// Normalize date fields in progress updates
		let normalizedProgress = job.progress;
		if (job.progress && Array.isArray(job.progress)) {
			normalizedProgress = job.progress.map((update) => ({
				...update,
				timestamp: update.timestamp ? new Date(update.timestamp) : undefined,
			}));
		}

		const norm: BaseJob = {
			...job,
			createdAt: new Date(job.createdAt as Date),
			startedAt: job.startedAt ? new Date(job.startedAt as Date) : undefined,
			completedAt: job.completedAt
				? new Date(job.completedAt as Date)
				: undefined,
			progress: normalizedProgress || [],
		};
		await this.store.put(norm);
	}
}

export const backgroundJob = BackgroundJob.getInstance();
