import { logInfo, logError } from "@/utils/logger";
import type {
	IJobNotificationBridge,
	JobNotificationMessage,
	ContextType,
	DestinationType,
	BridgeStatus,
} from "./types";
import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";

/**
 * Chrome Runtime-based job notification bridge
 * Cross-context job notification bridge using chrome.runtime.sendMessage
 * Works across all extension contexts (embedded → background → offscreen)
 */
export class ChromeRuntimeBridge implements IJobNotificationBridge {
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private isInitialized = false;
	private contextType: ContextType;

	constructor() {
		this.contextType = this.detectContextType();
		logInfo(`[ChromeRuntimeBridge] initialized for ${this.contextType}`);
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
		// Listen for chrome.runtime messages for cross-context communication
		if (typeof chrome !== "undefined" && chrome.runtime) {
			chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
				if (message.type === "JOB_NOTIFICATION_BRIDGE") {
					const jobMessage = message.jobMessage as JobNotificationMessage;

					// Filter messages by destination - ignore messages not intended for this context
					if (
						jobMessage.destination &&
						jobMessage.destination !== "all" &&
						jobMessage.destination !== this.contextType
					) {
						return;
					}

					// Ignore messages from self unless specifically targeted
					if (
						jobMessage.sender === this.contextType &&
						!jobMessage.destination
					) {
						return;
					}

					// Notify all subscribers for this message type
					this.notifyLocalListeners(jobMessage);

					sendResponse({ success: true });
					return true;
				}
			});
		}

		this.isInitialized = true;
		logInfo(
			`🚀 ChromeRuntime bridge initialized for ${this.contextType} context`,
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

		// Return unsubscribe function
		return () => {
			typeListeners.delete(listener);
			if (typeListeners.size === 0) {
				this.listeners.delete(messageType);
			}
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
			logError("ChromeRuntime bridge not initialized");
			return;
		}

		// Use chrome.runtime.sendMessage for cross-context communication
		if (typeof chrome !== "undefined" && chrome.runtime) {
			try {
				chrome.runtime
					.sendMessage({
						type: "JOB_NOTIFICATION_BRIDGE",
						jobMessage: message,
					})
					.catch((error) => {
						logError(
							`Failed to send job notification ${message.type} via chrome.runtime:`,
							error,
						);
					});
			} catch (error) {
				logError(
					`Failed to send job notification ${message.type} via chrome.runtime:`,
					error,
				);
			}
		} else {
			logError("Chrome runtime not available for job notification bridge");
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
			connectionType: "ChromeRuntime",
		};
	}

	close(): void {
		try {
			this.listeners.clear();
			this.isInitialized = false;
			logInfo("📡 ChromeRuntime bridge closed");
		} catch (error) {
			logError("Error closing ChromeRuntime bridge:", error);
		}
	}
}
