import { logInfo, logError } from "@/utils/logger";
import type { BaseJob, JobResult } from "./offscreen-handlers/types";

export interface JobNotificationMessage {
	type: "JOB_ENQUEUED" | "JOB_UPDATED" | "JOB_COMPLETED" | "QUEUE_UPDATED";
	jobId?: string;
	job?: BaseJob;
	result?: JobResult;
	timestamp: number;
	sender: "background" | "offscreen" | "ui";
	destination?: "background" | "offscreen" | "ui" | "all";
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
	private contextType: "background" | "offscreen" | "ui";

	private constructor() {
		this.channel = new BroadcastChannel("memorall-job-queue");
		this.contextType = this.detectContextType();
		this.setupEventListeners();
	}

	private detectContextType(): "background" | "offscreen" | "ui" {
		if (typeof chrome !== "undefined" && chrome.runtime) {
			try {
				if (document.URL.endsWith("offscreen.html")) {
					return "offscreen";
				}
			} catch {
			}
		}
		return "ui";
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

				// Filter messages by destination - ignore messages not intended for this context
				if (message.destination && message.destination !== "all" && message.destination !== this.contextType) {
					return;
				}

				// Ignore messages from self unless specifically targeted
				if (message.sender === this.contextType && !message.destination) {
					return;
				}

				logInfo(`📡 [${this.contextType}] Received job notification: [${message.jobId}] ${message.type} from ${message.sender} (${Date.now() - message.timestamp}ms)`);

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
		logInfo(`🚀 Job notification channel initialized for ${this.contextType} context`);
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
	notifyJobEnqueued(job: BaseJob, destination?: "background" | "offscreen" | "ui" | "all"): void {
		this.postMessage({
			type: "JOB_ENQUEUED",
			jobId: job.id,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "offscreen", // Default to offscreen for processing
		});
	}

	/**
	 * Notify that a job has been updated
	 */
	notifyJobUpdated(jobId: string, job: BaseJob, destination?: "background" | "offscreen" | "ui" | "all"): void {
		this.postMessage({
			type: "JOB_UPDATED",
			jobId,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all", // Updates go to all contexts
		});
	}

	/**
	 * Notify that a job has been completed
	 */
	notifyJobCompleted(jobId: string, result?: JobResult, destination?: "background" | "offscreen" | "ui" | "all"): void {
		this.postMessage({
			type: "JOB_COMPLETED",
			jobId,
			result,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "background", // Completions go to background by default
		});
	}

	/**
	 * Notify that the queue has been updated (general notification)
	 */
	notifyQueueUpdated(destination?: "background" | "offscreen" | "ui" | "all"): void {
		this.postMessage({
			type: "QUEUE_UPDATED",
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all", // Queue updates go to all contexts
		});
	}

	private postMessage(message: JobNotificationMessage): void {
		if (!this.isInitialized) {
			logError("Job notification channel not initialized");
			return;
		}

		try {
			this.channel.postMessage(message);
			logInfo(`📡 [${this.contextType}] Sent job notification: ${message.type} to ${message.destination || "all"}`, {
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
