import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";
import type {
	BridgeStatus,
	ContextType,
	IJobNotificationBridge,
	JobNotificationMessage,
	MessageTarget,
} from "./types";
import type { IServiceInitializationBridge } from "./service-initialization";

export class LocalJobNotificationBridge implements IJobNotificationBridge {
	private readonly listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	private closed = false;

	subscribe(
		type: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void {
		const bucket = this.listeners.get(type) ?? new Set();
		bucket.add(listener);
		this.listeners.set(type, bucket);
		return () => bucket.delete(listener);
	}

	notifyJobEnqueued(job: BaseJob, target: MessageTarget = "offscreen"): void {
		this.send({ type: "JOB_ENQUEUED", target, jobId: job.id, job });
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
		return "popup";
	}
	getStatus(): BridgeStatus {
		return {
			isInitialized: !this.closed,
			listenerCount: [...this.listeners.values()].reduce(
				(total, bucket) => total + bucket.size,
				0,
			),
			subscribedTypes: [...this.listeners.keys()],
		};
	}
	close(): void {
		this.closed = true;
		this.listeners.clear();
	}

	private send(
		message: Omit<JobNotificationMessage, "sender" | "timestamp">,
	): void {
		if (this.closed) return;
		const complete: JobNotificationMessage = {
			...message,
			sender: "popup",
			timestamp: Date.now(),
		};
		for (const listener of this.listeners.get(complete.type) ?? [])
			listener(complete);
		for (const listener of this.listeners.get("*") ?? []) listener(complete);
	}
}

export function createJobNotificationBridge(): IJobNotificationBridge {
	return new LocalJobNotificationBridge();
}

export function createServiceInitializationBridge(): IServiceInitializationBridge {
	return {
		async initialize() {
			return {
				async *[Symbol.asyncIterator]() {
					yield {
						stage: "Services initialized",
						progress: 100,
						status: "completed",
					};
				},
			};
		},
	};
}
