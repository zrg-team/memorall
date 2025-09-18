// Base types and interfaces for process handlers

// Only truly universal job statuses - handlers can extend with their own
export type BaseJobStatus = "pending" | "processing" | "completed" | "failed";

export interface JobProgressUpdate {
	status: string; // Handlers define their own status types
	stage: string;
	progress: number;
	completedAt?: Date;
	pageId?: string;
	error?: string;
}

export interface JobResultData {
	pageId?: string;
	serviceName?: string;
	pageTitle?: string;
	[key: string]: unknown;
}

export interface JobResult {
	success: boolean;
	error?: string;
	data?: JobResultData;
}

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

export interface ProcessHandler<TJob = Record<string, unknown>> {
	process(
		jobId: string,
		job: TJob,
		dependencies: ProcessDependencies,
	): Promise<void>;
}

// Generic job interface - foundation for all job types
export interface BaseJob {
	id: string;
	jobType: string;
	status: string;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
	[key: string]: unknown; // Allow any additional properties including progress
}

export interface ProcessMessage {
	type: string;
	[key: string]: unknown;
}
