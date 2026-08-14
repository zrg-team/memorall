import { logError, logInfo } from "@/utils/logger";
import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";
import type {
	BridgeStatus,
	ContextType,
	IJobNotificationBridge,
	JobNotificationMessage,
	MessageTarget,
} from "./types";
import { isJobNotificationMessage } from "./types";

/**
 * Chrome Runtime job notification bridge.
 *
 * Transport rule (MV3):
 *   chrome.runtime.sendMessage() reaches every extension page (background,
 *   popup, standalone, offscreen) but NOT content scripts.
 *   Background relays target="content"|"all" to content scripts via
 *   chrome.tabs.sendMessage() — see the relay section in background.ts.
 */
export class ChromeRuntimeBridge implements IJobNotificationBridge {
	private static readonly enqueueAttempts = 4;
	private static readonly enqueueRetryDelayMs = 100;
	private readonly listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private readonly contextType: ContextType;
	private isReady = false;

	constructor(contextType?: ContextType) {
		this.contextType = contextType ?? ChromeRuntimeBridge.detectContext();
		this.setupListener();
		logInfo(`[ChromeRuntimeBridge] ready for "${this.contextType}"`);
	}

	// ─── Context detection ────────────────────────────────────────────────────

	private static detectContext(): ContextType {
		if (typeof chrome === "undefined" || !chrome.runtime) return "background";
		if (typeof document !== "undefined") {
			// Offscreen document URL always ends with offscreen.html
			if (document.URL.endsWith("offscreen.html")) return "offscreen";
			// Content scripts are injected into web pages
			if (
				document.URL.startsWith("https://") ||
				document.URL.startsWith("http://")
			)
				return "content";
			// Remaining chrome-extension:// pages: popup.html, standalone.html, etc.
			return "popup";
		}
		// No document = service worker (background)
		return "background";
	}

	// ─── Incoming message listener ────────────────────────────────────────────

	private setupListener(): void {
		if (typeof chrome === "undefined" || !chrome.runtime) return;

		chrome.runtime.onMessage.addListener(
			(rawMessage: unknown, _sender, sendResponse) => {
				if (!isJobNotificationMessage(rawMessage)) return;
				if (!this.isForMe(rawMessage.target)) return;
				const hasJobConsumer =
					(this.listeners.get(rawMessage.type)?.size ?? 0) > 0 ||
					(this.listeners.get("*")?.size ?? 0) > 0;
				this.dispatch(rawMessage);
				if (
					rawMessage.type === "JOB_ENQUEUED" &&
					this.contextType === "offscreen" &&
					hasJobConsumer
				) {
					sendResponse({
						accepted: true,
						context: "offscreen",
						jobId: rawMessage.jobId,
					});
				}
				return false;
			},
		);

		this.isReady = true;
	}

	private isForMe(target: MessageTarget): boolean {
		return target === "all" || target === this.contextType;
	}

	private dispatch(message: JobNotificationMessage): void {
		this.listeners.get(message.type)?.forEach((fn) => {
			try {
				fn(message);
			} catch (err) {
				logError(`[Bridge] listener error (${message.type}):`, err);
			}
		});
		this.listeners.get("*")?.forEach((fn) => {
			try {
				fn(message);
			} catch (err) {
				logError("[Bridge] wildcard listener error:", err);
			}
		});
	}

	// ─── IJobNotificationBridge ───────────────────────────────────────────────

	subscribe(
		messageType: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void {
		let bucket = this.listeners.get(messageType);
		if (!bucket) {
			bucket = new Set();
			this.listeners.set(messageType, bucket);
		}
		bucket.add(listener);
		return () => {
			bucket!.delete(listener);
			if (bucket!.size === 0) this.listeners.delete(messageType);
		};
	}

	async notifyJobEnqueued(
		job: BaseJob,
		target: MessageTarget = "offscreen",
	): Promise<void> {
		if (target !== "offscreen") {
			this.send({ type: "JOB_ENQUEUED", target, jobId: job.id, job });
			return;
		}

		const message = this.createMessage({
			type: "JOB_ENQUEUED",
			target,
			jobId: job.id,
			job,
		});
		let lastError: unknown;
		for (
			let attempt = 1;
			attempt <= ChromeRuntimeBridge.enqueueAttempts;
			attempt++
		) {
			try {
				const response = (await chrome.runtime.sendMessage(message)) as
					| { accepted?: boolean; context?: string; jobId?: string }
					| undefined;
				if (
					response?.accepted === true &&
					response.context === "offscreen" &&
					response.jobId === job.id
				) {
					return;
				}
				lastError = new Error("Offscreen runtime did not acknowledge the job");
			} catch (error) {
				lastError = error;
			}
			if (attempt < ChromeRuntimeBridge.enqueueAttempts) {
				await new Promise((resolve) =>
					setTimeout(
						resolve,
						ChromeRuntimeBridge.enqueueRetryDelayMs * 2 ** (attempt - 1),
					),
				);
			}
		}
		throw new Error(
			`Offscreen runtime did not accept job ${job.id} after ${ChromeRuntimeBridge.enqueueAttempts} attempts`,
			{ cause: lastError },
		);
	}

	notifyJobUpdated(
		jobId: string,
		job: BaseJob,
		target: MessageTarget = "all",
	): void {
		this.send({ type: "JOB_UPDATED", target, jobId, job });
	}

	notifyJobProgress(
		jobId: string,
		progress: JobProgressEvent,
		target: MessageTarget = "all",
	): void {
		this.send({ type: "JOB_PROGRESS", target, jobId, progress });
	}

	notifyJobCompleted(
		jobId: string,
		result?: JobResult,
		target: MessageTarget = "all",
	): void {
		this.send({ type: "JOB_COMPLETED", target, jobId, result });
	}

	notifyQueueUpdated(target: MessageTarget = "all"): void {
		this.send({ type: "QUEUE_UPDATED", target });
	}

	getContextType(): ContextType {
		return this.contextType;
	}

	getStatus(): BridgeStatus {
		return {
			isInitialized: this.isReady,
			listenerCount: Array.from(this.listeners.values()).reduce(
				(n, s) => n + s.size,
				0,
			),
			subscribedTypes: Array.from(this.listeners.keys()),
		};
	}

	close(): void {
		this.listeners.clear();
		this.isReady = false;
		logInfo("[Bridge] ChromeRuntimeBridge closed");
	}

	// ─── Send ─────────────────────────────────────────────────────────────────

	private send(
		partial: Omit<JobNotificationMessage, "sender" | "timestamp">,
	): void {
		if (!this.isReady) return;

		const message = this.createMessage(partial);

		chrome.runtime.sendMessage(message).catch((err: Error) => {
			// "Receiving end does not exist" is normal when no other context is open
			if (
				!err.message?.includes("Receiving end does not exist") &&
				!err.message?.includes("Could not establish connection")
			) {
				logError(`[Bridge] failed to send ${message.type}:`, err);
			}
		});
	}

	private createMessage(
		partial: Omit<JobNotificationMessage, "sender" | "timestamp">,
	): JobNotificationMessage {
		return {
			...partial,
			sender: this.contextType,
			timestamp: Date.now(),
		};
	}
}
