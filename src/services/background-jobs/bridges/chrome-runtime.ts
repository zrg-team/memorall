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
	// Only needs to outlive the window in which a duplicate can arrive, which is
	// one relay hop.
	private static readonly dispatchHistorySize = 512;
	private readonly listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private readonly contextType: ContextType;
	private isReady = false;
	private announcedAsConsumer = false;
	// Sender-scoped so ids stay unique across service-worker restarts, where a
	// plain counter would restart at 1 and collide with what receivers remember.
	private readonly senderId = Math.random().toString(36).slice(2, 10);
	private sequence = 0;
	private readonly dispatchedIds = new Set<string>();
	private readonly dispatchedOrder: string[] = [];

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
				if (this.alreadyDispatched(rawMessage)) return;
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

	/**
	 * Drop a notification this context has already handled.
	 *
	 * An extension page open in a tab can be reached twice — directly by
	 * chrome.runtime.sendMessage and again by the background relay. Delivering a
	 * progress update twice makes the consumer append the same text twice, which
	 * shows up as the assistant's own words interleaved with themselves. The
	 * relay is careful not to do this, and this makes it harmless if it ever
	 * does again.
	 */
	private alreadyDispatched(message: JobNotificationMessage): boolean {
		const id = message.messageId;
		if (!id) return false;
		if (this.dispatchedIds.has(id)) return true;

		this.dispatchedIds.add(id);
		this.dispatchedOrder.push(id);
		if (this.dispatchedOrder.length > ChromeRuntimeBridge.dispatchHistorySize) {
			const evicted = this.dispatchedOrder.shift();
			if (evicted) this.dispatchedIds.delete(evicted);
		}
		return false;
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
		this.announceContentConsumer();
		return () => {
			bucket!.delete(listener);
			if (bucket!.size === 0) this.listeners.delete(messageType);
		};
	}

	/**
	 * Tell the background this tab consumes job notifications.
	 *
	 * Broadcasts reach content scripts only through a background relay, and that
	 * relay now only talks to tabs known to be listening — otherwise a streaming
	 * chat messages every open tab once per chunk for nothing. A content script
	 * that subscribes without ever enqueueing a job would be invisible to it, so
	 * it says so itself.
	 */
	private announceContentConsumer(): void {
		if (this.contextType !== "content" || this.announcedAsConsumer) return;
		this.announcedAsConsumer = true;
		this.send({ type: "QUEUE_UPDATED", target: "background" });
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
		this.sequence += 1;
		return {
			...partial,
			sender: this.contextType,
			timestamp: Date.now(),
			messageId: `${this.senderId}:${this.sequence}`,
		};
	}
}
