import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";

export interface JobNotificationMessage {
	type:
		| "JOB_ENQUEUED"
		| "JOB_UPDATED"
		| "JOB_COMPLETED"
		| "QUEUE_UPDATED"
		| "JOB_PROGRESS";
	jobId?: string;
	job?: BaseJob;
	result?: JobResult;
	progress?: JobProgressEvent;
	timestamp: number;
	sender: "background" | "offscreen" | "ui" | "embedded";
	destination?: "background" | "offscreen" | "ui" | "all" | "embedded";
}

export type ContextType = "background" | "offscreen" | "ui" | "embedded";
export type DestinationType =
	| "background"
	| "offscreen"
	| "ui"
	| "all"
	| "embedded";

export interface BridgeStatus {
	isInitialized: boolean;
	listenerCount: number;
	subscribedTypes: string[];
	connectionType: string;
}

/**
 * Base interface for all job notification bridges
 * All bridge implementations must extend this interface
 */
export interface IJobNotificationBridge {
	/**
	 * Subscribe to job notifications
	 * @param messageType - Specific message type or '*' for all messages
	 * @param listener - Callback function
	 * @returns Unsubscribe function
	 */
	subscribe(
		messageType: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void;

	/**
	 * Notify that a new job has been enqueued
	 */
	notifyJobEnqueued(job: BaseJob, destination?: DestinationType): void;

	/**
	 * Notify that a job has been updated
	 */
	notifyJobUpdated(
		jobId: string,
		job: BaseJob,
		destination?: DestinationType,
	): void;

	/**
	 * Notify progress for a job
	 */
	notifyJobProgress(
		jobId: string,
		progress: JobProgressEvent,
		destination?: DestinationType,
	): void;

	/**
	 * Notify that a job has been completed
	 */
	notifyJobCompleted(
		jobId: string,
		result?: JobResult,
		destination?: DestinationType,
	): void;

	/**
	 * Notify that the queue has been updated
	 */
	notifyQueueUpdated(destination?: DestinationType): void;

	/**
	 * Get the current context type
	 */
	getContextType(): ContextType;

	/**
	 * Get bridge status for debugging
	 */
	getStatus(): BridgeStatus;

	/**
	 * Close the bridge connection
	 */
	close(): void;
}
