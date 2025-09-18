import { logInfo, logError } from "@/utils/logger";
import type { BackgroundJob } from "./background-job-queue";

export interface JobPortMessage {
	type: 'NEW_JOB' | 'JOB_UPDATED' | 'JOB_COMPLETED' | 'PING' | 'PONG';
	jobId?: string;
	job?: BackgroundJob;
	timestamp: number;
}

/**
 * High-performance persistent connection manager using chrome.runtime.Port
 * for immediate job notifications between background and offscreen contexts.
 *
 * This provides even lower latency than BroadcastChannel for cross-context communication.
 */
export class JobPortManager {
	private static instance: JobPortManager;
	private port: chrome.runtime.Port | null = null;
	private listeners = new Map<string, Set<(message: JobPortMessage) => void>>();
	private reconnectTimeout: NodeJS.Timeout | null = null;
	private isConnected = false;
	private connectionAttempts = 0;
	private maxReconnectAttempts = 5;

	private constructor() {
		this.setupPort();
	}

	static getInstance(): JobPortManager {
		if (!JobPortManager.instance) {
			JobPortManager.instance = new JobPortManager();
		}
		return JobPortManager.instance;
	}

	private setupPort(): void {
		try {
			if (chrome.runtime?.connect) {
				this.port = chrome.runtime.connect({ name: 'memorall-job-queue' });
				this.setupPortListeners();
				this.isConnected = true;
				this.connectionAttempts = 0;
				logInfo('🔌 Job port connection established');
			}
		} catch (error) {
			logError('Failed to establish port connection:', error);
			this.scheduleReconnect();
		}
	}

	private setupPortListeners(): void {
		if (!this.port) return;

		this.port.onMessage.addListener((message: JobPortMessage) => {
			try {
				logInfo(`📡 Port message received: ${message.type}`, {
					jobId: message.jobId,
					latency: Date.now() - message.timestamp
				});

				// Notify all subscribers for this message type
				const typeListeners = this.listeners.get(message.type);
				if (typeListeners) {
					typeListeners.forEach(listener => {
						try {
							listener(message);
						} catch (error) {
							logError(`Error in port listener for ${message.type}:`, error);
						}
					});
				}

				// Notify wildcard listeners
				const wildcardListeners = this.listeners.get('*');
				if (wildcardListeners) {
					wildcardListeners.forEach(listener => {
						try {
							listener(message);
						} catch (error) {
							logError('Error in wildcard port listener:', error);
						}
					});
				}
			} catch (error) {
				logError('Error processing port message:', error);
			}
		});

		this.port.onDisconnect.addListener(() => {
			logInfo('🔌 Port connection lost, scheduling reconnect');
			this.isConnected = false;
			this.port = null;
			this.scheduleReconnect();
		});

		// Send initial ping to establish connection
		this.sendMessage({
			type: 'PING',
			timestamp: Date.now()
		});
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
		}

		if (this.connectionAttempts >= this.maxReconnectAttempts) {
			logError('Max reconnection attempts reached, giving up on port connection');
			return;
		}

		const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000); // Exponential backoff, max 30s
		this.connectionAttempts++;

		this.reconnectTimeout = setTimeout(() => {
			logInfo(`🔄 Attempting port reconnection (attempt ${this.connectionAttempts}/${this.maxReconnectAttempts})`);
			this.setupPort();
		}, delay);
	}

	/**
	 * Subscribe to port messages
	 * @param messageType - Specific message type or '*' for all messages
	 * @param listener - Callback function
	 * @returns Unsubscribe function
	 */
	subscribe(
		messageType: JobPortMessage['type'] | '*',
		listener: (message: JobPortMessage) => void
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

	/**
	 * Send a message via the port connection
	 */
	sendMessage(message: JobPortMessage): void {
		if (!this.isConnected || !this.port) {
			logError('Port not connected, cannot send message:', message.type);
			return;
		}

		try {
			this.port.postMessage(message);
			logInfo(`📡 Port message sent: ${message.type}`, {
				jobId: message.jobId,
				timestamp: message.timestamp
			});
		} catch (error) {
			logError(`Failed to send port message ${message.type}:`, error);
			this.isConnected = false;
			this.scheduleReconnect();
		}
	}

	/**
	 * Notify about a new job via port
	 */
	notifyNewJob(job: BackgroundJob): void {
		this.sendMessage({
			type: 'NEW_JOB',
			jobId: job.id,
			job,
			timestamp: Date.now()
		});
	}

	/**
	 * Notify about a job update via port
	 */
	notifyJobUpdated(jobId: string, job?: BackgroundJob): void {
		this.sendMessage({
			type: 'JOB_UPDATED',
			jobId,
			job,
			timestamp: Date.now()
		});
	}

	/**
	 * Notify about a job completion via port
	 */
	notifyJobCompleted(jobId: string): void {
		this.sendMessage({
			type: 'JOB_COMPLETED',
			jobId,
			timestamp: Date.now()
		});
	}

	/**
	 * Get connection status
	 */
	getStatus(): {
		isConnected: boolean;
		connectionAttempts: number;
		listenerCount: number;
		subscribedTypes: string[];
	} {
		return {
			isConnected: this.isConnected,
			connectionAttempts: this.connectionAttempts,
			listenerCount: Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0),
			subscribedTypes: Array.from(this.listeners.keys())
		};
	}

	/**
	 * Close the port connection
	 */
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
		logInfo('🔌 Job port manager closed');
	}
}

// Export singleton instance
export const jobPortManager = JobPortManager.getInstance();