import { logInfo, logError } from "@/utils/logger";
import type { BaseJob } from "./offscreen-handlers/types";

export interface JobNotificationMessage {
	type: "JOB_ENQUEUED" | "JOB_UPDATED" | "JOB_COMPLETED" | "QUEUE_UPDATED";
	jobId?: string;
	job?: BaseJob;
	timestamp: number;
}

/**
 * High-performance job notification system using BroadcastChannel API
 * for immediate (<50ms) cross-context communication within the same origin.
 *
 * This replaces polling mechanisms with event-driven notifications.
 */
export class JobNotificationChannel {
	private static instance: JobNotificationChannel;
	private channel: BroadcastChannel;
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private isInitialized = false;

	private constructor() {
		this.channel = new BroadcastChannel("memorall-job-queue");
		this.setupEventListeners();
	}

	static getInstance(): JobNotificationChannel {
		if (!JobNotificationChannel.instance) {
			JobNotificationChannel.instance = new JobNotificationChannel();
		}
		return JobNotificationChannel.instance;
	}

	private setupEventListeners(): void {
		this.channel.addEventListener("message", (event) => {
			try {
				const message = event.data as JobNotificationMessage;
				logInfo(`📡 Received job notification: ${message.type}`, {
					jobId: message.jobId,
					latency: Date.now() - message.timestamp,
				});

				// Notify all subscribers for this message type
				const typeListeners = this.listeners.get(message.type);
				if (typeListeners) {
					typeListeners.forEach((listener) => {
						try {
							listener(message);
						} catch (error) {
							logError(
								`Error in job notification listener for ${message.type}:`,
								error,
							);
						}
					});
				}

				// Notify wildcard listeners
				const wildcardListeners = this.listeners.get("*");
				if (wildcardListeners) {
					wildcardListeners.forEach((listener) => {
						try {
							listener(message);
						} catch (error) {
							logError("Error in wildcard job notification listener:", error);
						}
					});
				}
			} catch (error) {
				logError("Error processing job notification message:", error);
			}
		});

		this.isInitialized = true;
		logInfo("🚀 Job notification channel initialized");
	}

	/**
	 * Subscribe to job notifications
	 * @param messageType - Specific message type or '*' for all messages
	 * @param listener - Callback function
	 * @returns Unsubscribe function
	 */
	subscribe(
		messageType: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void {
		if (!this.listeners.has(messageType)) {
			this.listeners.set(messageType, new Set());
		}

		const typeListeners = this.listeners.get(messageType)!;
		typeListeners.add(listener);

		logInfo(`📝 Subscribed to job notifications: ${messageType}`);

		// Return unsubscribe function
		return () => {
			typeListeners.delete(listener);
			if (typeListeners.size === 0) {
				this.listeners.delete(messageType);
			}
			logInfo(`📝 Unsubscribed from job notifications: ${messageType}`);
		};
	}

	/**
	 * Notify that a new job has been enqueued (immediate notification)
	 */
	notifyJobEnqueued(job: BaseJob): void {
		this.postMessage({
			type: "JOB_ENQUEUED",
			jobId: job.id,
			job,
			timestamp: Date.now(),
		});
	}

	/**
	 * Notify that a job has been updated
	 */
	notifyJobUpdated(jobId: string, job: BaseJob): void {
		this.postMessage({
			type: "JOB_UPDATED",
			jobId,
			job,
			timestamp: Date.now(),
		});
	}

	/**
	 * Notify that a job has been completed
	 */
	notifyJobCompleted(jobId: string): void {
		this.postMessage({
			type: "JOB_COMPLETED",
			jobId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Notify that the queue has been updated (general notification)
	 */
	notifyQueueUpdated(): void {
		this.postMessage({
			type: "QUEUE_UPDATED",
			timestamp: Date.now(),
		});
	}

	private postMessage(message: JobNotificationMessage): void {
		if (!this.isInitialized) {
			logError("Job notification channel not initialized");
			return;
		}

		try {
			this.channel.postMessage(message);
			logInfo(`📡 Sent job notification: ${message.type}`, {
				jobId: message.jobId,
				timestamp: message.timestamp,
			});
		} catch (error) {
			logError(`Failed to send job notification ${message.type}:`, error);
		}
	}

	/**
	 * Close the notification channel
	 */
	close(): void {
		try {
			this.channel.close();
			this.listeners.clear();
			this.isInitialized = false;
			logInfo("📡 Job notification channel closed");
		} catch (error) {
			logError("Error closing job notification channel:", error);
		}
	}

	/**
	 * Get channel status for debugging
	 */
	getStatus(): {
		isInitialized: boolean;
		listenerCount: number;
		subscribedTypes: string[];
	} {
		return {
			isInitialized: this.isInitialized,
			listenerCount: Array.from(this.listeners.values()).reduce(
				(sum, set) => sum + set.size,
				0,
			),
			subscribedTypes: Array.from(this.listeners.keys()),
		};
	}
}

// Export singleton instance
export const jobNotificationChannel = JobNotificationChannel.getInstance();
