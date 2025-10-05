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
 * Chrome Port-based job notification bridge
 * High-performance persistent connection manager using chrome.runtime.Port
 * for immediate job notifications between background and offscreen contexts.
 * This provides even lower latency than BroadcastChannel for cross-context communication.
 */
export class ChromePortBridge implements IJobNotificationBridge {
	private port: chrome.runtime.Port | null = null;
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private isConnected = false;
	private connectionAttempts = 0;
	private maxReconnectAttempts = 5;
	private contextType: ContextType;

	constructor() {
		this.contextType = this.detectContextType();
		logInfo(`[ChromePortBridge] initialized for ${this.contextType}`);
		this.setupPort();
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

	private setupPort(): void {
		try {
			if (chrome.runtime?.connect) {
				this.port = chrome.runtime.connect({ name: "memorall-job-queue" });
				this.setupPortListeners();
				this.isConnected = true;
				this.connectionAttempts = 0;
				logInfo("🔌 ChromePort bridge connection established");
			}
		} catch (error) {
			logError("Failed to establish port connection:", error);
			this.scheduleReconnect();
		}
	}

	private setupPortListeners(): void {
		if (!this.port) return;

		this.port.onMessage.addListener((message: JobNotificationMessage) => {
			try {
				logInfo(`📡 Port message received: ${message.type}`, {
					jobId: message.jobId,
					latency: Date.now() - message.timestamp,
				});

				// Filter messages by destination
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
				logError("Error processing port message:", error);
			}
		});

		this.port.onDisconnect.addListener(() => {
			logInfo("🔌 Port connection lost, scheduling reconnect");
			this.isConnected = false;
			this.port = null;
			this.scheduleReconnect();
		});

		// Send initial ping to establish connection
		this.sendMessage({
			type: "JOB_ENQUEUED",
			timestamp: Date.now(),
			sender: this.contextType,
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		if (this.connectionAttempts >= this.maxReconnectAttempts) {
			logError(
				"Max reconnection attempts reached, giving up on port connection",
			);
			return;
		}

		const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000); // Exponential backoff, max 30s
		this.connectionAttempts++;

		this.reconnectTimeout = setTimeout(() => {
			logInfo(
				`🔄 Attempting port reconnection (attempt ${this.connectionAttempts}/${this.maxReconnectAttempts})`,
			);
			this.setupPort();
		}, delay);
	}

	private notifyLocalListeners(message: JobNotificationMessage): void {
		// Notify all subscribers for this message type
		const typeListeners = this.listeners.get(message.type);
		if (typeListeners) {
			typeListeners.forEach((listener) => {
				try {
					listener(message);
				} catch (error) {
					logError(`Error in port listener for ${message.type}:`, error);
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
					logError("Error in wildcard port listener:", error);
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

		logInfo(`📝 Subscribed to port messages: ${messageType}`);

		// Return unsubscribe function
		return () => {
			typeListeners.delete(listener);
			if (typeListeners.size === 0) {
				this.listeners.delete(messageType);
			}
			logInfo(`📝 Unsubscribed from port messages: ${messageType}`);
		};
	}

	notifyJobEnqueued(job: BaseJob, destination?: DestinationType): void {
		this.sendMessage({
			type: "JOB_ENQUEUED",
			jobId: job.id,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "offscreen",
		});
	}

	notifyJobUpdated(
		jobId: string,
		job: BaseJob,
		destination?: DestinationType,
	): void {
		this.sendMessage({
			type: "JOB_UPDATED",
			jobId,
			job,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all",
		});
	}

	notifyJobProgress(
		jobId: string,
		progress: JobProgressEvent,
		destination?: DestinationType,
	): void {
		this.sendMessage({
			type: "JOB_PROGRESS",
			jobId,
			progress,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all",
		});
	}

	notifyJobCompleted(
		jobId: string,
		result?: JobResult,
		destination?: DestinationType,
	): void {
		this.sendMessage({
			type: "JOB_COMPLETED",
			jobId,
			result,
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "background",
		});
	}

	notifyQueueUpdated(destination?: DestinationType): void {
		this.sendMessage({
			type: "QUEUE_UPDATED",
			timestamp: Date.now(),
			sender: this.contextType,
			destination: destination || "all",
		});
	}

	private sendMessage(message: JobNotificationMessage): void {
		if (!this.isConnected || !this.port) {
			logError("Port not connected, cannot send message:", message.type);
			return;
		}

		try {
			this.port.postMessage(message);
			logInfo(`📡 Port message sent: ${message.type}`, {
				jobId: message.jobId,
				timestamp: message.timestamp,
			});
		} catch (error) {
			logError(`Failed to send port message ${message.type}:`, error);
			this.isConnected = false;
			this.scheduleReconnect();
		}
	}

	getContextType(): ContextType {
		return this.contextType;
	}

	getStatus(): BridgeStatus {
		return {
			isInitialized: this.isConnected,
			listenerCount: Array.from(this.listeners.values()).reduce(
				(sum, set) => sum + set.size,
				0,
			),
			subscribedTypes: Array.from(this.listeners.keys()),
			connectionType: "ChromePort",
		};
	}

	close(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.port) {
			this.port.disconnect();
			this.port = null;
		}

		this.isConnected = false;
		this.listeners.clear();
		logInfo("🔌 ChromePort bridge closed");
	}
}

// No singleton - use through BackgroundJob instead
