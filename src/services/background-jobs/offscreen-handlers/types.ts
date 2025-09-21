export type JobStatus = "pending" | "processing" | "completed" | "failed";

// Global job type registry for smart payload type inference
// Handlers extend this interface to register their job types and payload structures
declare global {
	interface JobTypeRegistry {
		// Empty by default - handlers will extend this interface
		// Example: 'basic-async': BasicAsyncPayload;
	}

	// Registry for handler result types (what handlers return)
	interface JobResultRegistry {
		// Empty by default - handlers will extend this interface
		// Example: 'basic-async': { result: string; message: string; delay: number };
	}
}

// Generic progress update interface
export interface JobProgressUpdate {
	stage: string;
	progress: number; // 0-100
	timestamp?: Date;
	metadata?: Record<string, unknown>; // Additional context for this progress step
}

export type ItemHandlerResult =
	| Record<string, unknown>
	| Record<string, unknown>[]
	| undefined;

export interface JobResult<T = ItemHandlerResult> {
	status: JobStatus;
	result?: T; // Extended by each handler for their specific data
	progress: JobProgressUpdate[]; // Array of progress updates throughout job execution
	error?: string; // Only present when status is "failed"
}

// Type helper to extract result type from JobResultRegistry
export type JobResultFor<T extends keyof JobResultRegistry> =
	T extends keyof JobResultRegistry
		? JobResult<JobResultRegistry[T]>
		: JobResult<ItemHandlerResult>;

export interface LoggerMethods {
	info: (
		message: string,
		data?: Record<string, unknown>,
		context?: string,
	) => Promise<void>;
	error: (message: string, error: unknown, context?: string) => Promise<void>;
	warn: (message: string, message2: string, context?: string) => Promise<void>;
	debug: (
		message: string,
		data?: Record<string, unknown>,
		context?: string,
	) => Promise<void>;
}

export interface ChromeMessage {
	type: string;
	jobId?: string;
	[key: string]: unknown;
}

export interface ProcessDependencies {
	logger: LoggerMethods;
	updateJobProgress: (
		jobId: string,
		progress: JobProgressUpdate,
	) => Promise<void>;
	completeJob: (jobId: string, result: JobResult) => Promise<void>;
	updateStatus: (message: string) => void;
	sendMessage: (message: ChromeMessage) => Promise<void>;
}

// Handler return interface - simplified to just return the result data
export interface HandlerResult {
	status: JobStatus;
	result?: Record<string, unknown>;
	error?: string;
}

export interface ProcessHandler<TJob = Record<string, unknown>> {
	process(
		jobId: string,
		job: TJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult>;
}

// Generic job interface - foundation for all job types
export interface BaseJob {
	id: string;
	jobType: string;
	status: JobStatus;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	progress: JobProgressUpdate[]; // Track all progress updates
	result?: Record<string, unknown>; // Final result data
	error?: string;
	[key: string]: unknown; // Allow any additional properties
}

export interface ProcessMessage {
	type: string;
	[key: string]: unknown;
}
