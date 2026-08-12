import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";

// ─── Context & target ────────────────────────────────────────────────────────
// "popup"   = popup.html + standalone.html  (chrome-extension:// with document)
// "content" = content script injected in a web page (https:// document)
// Context detection lives in ChromeRuntimeBridge.detectContext()
export type ContextType = "background" | "offscreen" | "popup" | "content";
export type MessageTarget = ContextType | "all";

// ─── Offscreen progress ──────────────────────────────────────────────────────
// Shared by offscreen (producer) and background-job (consumer via INITIAL_PROGRESS).
export interface OffscreenProgress {
	done: boolean;
	progress: number;
	status: string;
	services?: string[];
	error?: string;
}

// ─── Job notification message ─────────────────────────────────────────────────
// This IS the Chrome runtime message — no wrapper envelope.
// Transport: chrome.runtime.sendMessage() from any context.
// Background relays to content scripts via chrome.tabs.sendMessage() when
// target === "content" | "all".
export interface JobNotificationMessage {
	type:
		| "JOB_ENQUEUED"
		| "JOB_UPDATED"
		| "JOB_COMPLETED"
		| "QUEUE_UPDATED"
		| "JOB_PROGRESS";
	target: MessageTarget;
	sender: ContextType;
	timestamp: number;
	jobId?: string;
	job?: BaseJob;
	result?: JobResult;
	progress?: JobProgressEvent;
	/** Only relevant when target === "content". Omit to broadcast to all eligible tabs. */
	tabId?: number;
}

// ─── Type guard ───────────────────────────────────────────────────────────────
const JOB_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
	"JOB_ENQUEUED",
	"JOB_UPDATED",
	"JOB_COMPLETED",
	"QUEUE_UPDATED",
	"JOB_PROGRESS",
]);

export function isJobNotificationMessage(
	msg: unknown,
): msg is JobNotificationMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	return (
		typeof m["type"] === "string" &&
		JOB_NOTIFICATION_TYPES.has(m["type"]) &&
		typeof m["target"] === "string" &&
		typeof m["sender"] === "string" &&
		typeof m["timestamp"] === "number"
	);
}

// ─── Bridge interface ─────────────────────────────────────────────────────────
export interface BridgeStatus {
	isInitialized: boolean;
	listenerCount: number;
	subscribedTypes: string[];
}

export interface IJobNotificationBridge {
	subscribe(
		messageType: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void;

	notifyJobEnqueued(job: BaseJob, target?: MessageTarget): void;
	notifyJobUpdated(jobId: string, job: BaseJob, target?: MessageTarget): void;
	notifyJobProgress(
		jobId: string,
		progress: JobProgressEvent,
		target?: MessageTarget,
	): void;
	notifyJobCompleted(
		jobId: string,
		result?: JobResult,
		target?: MessageTarget,
	): void;
	notifyQueueUpdated(target?: MessageTarget): void;

	getContextType(): ContextType;
	getStatus(): BridgeStatus;
	close(): void;
}
