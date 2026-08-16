import { describe, expect, it, vi } from "vitest";
import { BackgroundJob } from "../background-job";
import { LocalJobNotificationBridge } from "../bridges/local-runtime";
import type {
	BridgeStatus,
	ContextType,
	IJobNotificationBridge,
	JobNotificationMessage,
	MessageTarget,
} from "../bridges/types";
import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";
import type { JobStore } from "../idb-job-store";

const createEmptyStore = (): JobStore => ({
	put: vi.fn(async (_job: BaseJob) => undefined),
	get: vi.fn(async (_id: string) => null),
	getAll: vi.fn(async () => []),
	delete: vi.fn(async (_id: string) => undefined),
	clearCompleted: vi.fn(async () => undefined),
});

class ImmediateCompletionBridge implements IJobNotificationBridge {
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();

	subscribe(
		type: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	): () => void {
		const bucket = this.listeners.get(type) ?? new Set();
		bucket.add(listener);
		this.listeners.set(type, bucket);
		return () => bucket.delete(listener);
	}

	notifyJobEnqueued(job: BaseJob, _target?: MessageTarget): void {
		const finalResult = { type: "final", content: "Immediate response." };
		this.dispatch({
			type: "JOB_COMPLETED",
			target: "all",
			jobId: job.id,
			result: {
				status: "completed",
				result: finalResult,
				progress: [],
			},
			sender: "offscreen",
			timestamp: Date.now(),
		});
	}

	notifyJobUpdated(): void {}
	notifyJobProgress(): void {}
	notifyJobCompleted(): void {}
	notifyQueueUpdated(): void {}
	getContextType(): ContextType {
		return "popup";
	}
	getStatus(): BridgeStatus {
		return {
			isInitialized: true,
			listenerCount: [...this.listeners.values()].reduce(
				(total, bucket) => total + bucket.size,
				0,
			),
			subscribedTypes: [...this.listeners.keys()],
		};
	}
	close(): void {
		this.listeners.clear();
	}

	private dispatch(message: JobNotificationMessage): void {
		for (const listener of this.listeners.get(message.type) ?? []) {
			listener(message);
		}
		for (const listener of this.listeners.get("*") ?? []) listener(message);
	}
}

describe("BackgroundJob direct completion", () => {
	it("subscribes before dispatch so an immediate cross-context completion is not lost", async () => {
		const jobs = BackgroundJob.create({
			store: createEmptyStore(),
			notificationBridge: new ImmediateCompletionBridge(),
		});
		const execution = await jobs.execute(
			"direct-stream-test",
			{},
			{ stream: true },
		);
		if (!("stream" in execution)) throw new Error("Expected a streaming job");

		const events: JobProgressEvent[] = [];
		for await (const event of execution.stream) events.push(event);

		expect(events).toEqual([
			expect.objectContaining({
				status: "completed",
				result: { type: "final", content: "Immediate response." },
			}),
		]);
	});

	it("emits the final event and closes a non-persisted local stream", async () => {
		const store = createEmptyStore();
		const bridge = new LocalJobNotificationBridge();
		const completed = vi.fn();
		bridge.subscribe("JOB_COMPLETED", completed);
		const jobs = BackgroundJob.create({
			store,
			notificationBridge: bridge,
		});
		const execution = await jobs.execute(
			"direct-stream-test",
			{},
			{
				stream: true,
			},
		);
		if (!("stream" in execution)) throw new Error("Expected a streaming job");
		const events: JobProgressEvent[] = [];
		const consume = (async () => {
			for await (const event of execution.stream) events.push(event);
		})();

		const finalResult = { type: "final", content: "Local inference works." };
		await jobs.updateJobProgress(execution.jobId, {
			stage: "Completed successfully",
			progress: 100,
			status: "completed",
			result: finalResult,
		});
		const completion: JobResult = {
			status: "completed",
			result: finalResult,
			progress: [],
		};
		await jobs.completeJob(execution.jobId, completion);
		await consume;

		expect(events).toEqual([
			expect.objectContaining({
				status: "completed",
				result: finalResult,
			}),
		]);
		expect(completed).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "JOB_COMPLETED",
				jobId: execution.jobId,
				result: completion,
			}),
		);
		expect(store.delete).not.toHaveBeenCalled();
	});
});
