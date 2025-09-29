import { logInfo, logError } from "@/utils/logger";
import type {
	IJobNotificationBridge,
	JobNotificationMessage,
	ContextType,
	DestinationType,
	BridgeStatus,
} from "./types";
import type {
	BaseJob,
	JobProgressEvent,
	JobResult,
} from "../offscreen-handlers/types";

/**
 * BroadcastChannel-based job notification bridge
 * High-performance job notification system using BroadcastChannel API
 * for immediate (<50ms) cross-context communication within the same origin.
 */
export class BroadcastChannelBridge implements IJobNotificationBridge {
	private channel: BroadcastChannel;
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private isInitialized = false;
	private contextType: ContextType;

	constructor() {
		this.channel = new BroadcastChannel("memorall-job-queue");
		this.contextType = this.detectContextType();
		logInfo(`[BroadcastChannelBridge] initialized for ${this.contextType}`);
		this.setupEventListeners();
	}

	private detectContextType(): ContextType {
		if (typeof chrome !== "undefined" && chrome.runtime) {
			if (typeof document !== "undefined") {
				try {
					if (document.URL.endsWith("offscreen.html")) {
						return "offscreen";
					}
				} catch {
					// fall through to ui when document access fails
				}
				try {
					if (document.URL.startsWith("https://")) {
						return "embedded";
					}
				} catch {
					// fall through to ui when document access fails
				}
				return "ui";
			}

			if (typeof window === "undefined") {
				return "background";
			}
		}
		if (
			typeof document !== "undefined" &&
			document.URL.startsWith("https://")
		) {
			return "embedded";
		}
		return "background";
	}

	private setupEventListeners(): void {
		this.channel.addEventListener("message", (event) => {
			try {
				const message = event.data as JobNotificationMessage;

				// Filter messages by destination - ignore messages not intended for this context
				if (
					message.destination &&
					message.destination !== "all" &&
					message.destination !== this.contextType
				) {
					return;
				}

				// Ignore messages from self unless specifically targeted
				if (message.sender === this.contextType && !message.destination) {
					return;
				}

				// Notify all subscribers for this message type
				this.notifyLocalListeners(message);
			} catch (error) {
				logError("Error processing job notification message:", error);
			}
		});

		this.isInitialized = true;
		logInfo(
			`🚀 BroadcastChannel bridge initialized for ${this.contextType} context`,
		);
	}

	private notifyLocalListeners(message: JobNotificationMessage): void {
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
	}

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

	notifyJobEnqueued(job: BaseJob, destination?: DestinationType): void {
		this.postMessage({
			type: "JOB_ENQUEUED",
			jobId: job.id,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "offscreen", // Default to offscreen for processing
		});
	}

	notifyJobUpdated(
		jobId: string,
		job: BaseJob,
		destination?: DestinationType,
	): void {
		this.postMessage({
			type: "JOB_UPDATED",
			jobId,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all", // Updates go to all contexts
		});
	}

	notifyJobProgress(
		jobId: string,
		progress: JobProgressEvent,
		destination?: DestinationType,
	): void {
		this.postMessage({
			type: "JOB_PROGRESS",
			jobId,
			progress,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all", // Progress updates consumed across contexts
		});
	}

	notifyJobCompleted(
		jobId: string,
		result?: JobResult,
		destination?: DestinationType,
	): void {
		this.postMessage({
			type: "JOB_COMPLETED",
			jobId,
			result,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "background", // Completions go to background by default
		});
	}

	notifyQueueUpdated(destination?: DestinationType): void {
		this.postMessage({
			type: "QUEUE_UPDATED",
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all", // Queue updates go to all contexts
		});
	}

	private postMessage(message: JobNotificationMessage): void {
		if (!this.isInitialized) {
			logError("BroadcastChannel bridge not initialized");
			return;
		}

		try {
			this.channel.postMessage(message);
		} catch (error) {
			logError(`Failed to send job notification ${message.type}:`, error);
		}
	}

	getContextType(): ContextType {
		return this.contextType;
	}

	getStatus(): BridgeStatus {
		return {
			isInitialized: this.isInitialized,
			listenerCount: Array.from(this.listeners.values()).reduce(
				(sum, set) => sum + set.size,
				0,
			),
			subscribedTypes: Array.from(this.listeners.keys()),
			connectionType: "BroadcastChannel",
		};
	}

	close(): void {
		try {
			this.channel.close();
			this.listeners.clear();
			this.isInitialized = false;
			logInfo("📡 BroadcastChannel bridge closed");
		} catch (error) {
			logError("Error closing BroadcastChannel bridge:", error);
		}
	}
}

// No singleton - use through BackgroundJob instead
