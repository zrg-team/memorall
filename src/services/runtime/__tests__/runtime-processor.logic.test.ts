import { describe, expect, it, vi } from "vitest";
import type {
	BridgeStatus,
	ContextType,
	IJobNotificationBridge,
	JobNotificationMessage,
	MessageTarget,
} from "@/services/background-jobs/bridges";
import type {
	BaseJob,
	JobProgressEvent,
	JobResult,
} from "@/services/background-jobs/handlers/types";
import { RuntimeProcessor } from "../runtime-processor";

class FakeBridge implements IJobNotificationBridge {
	private listeners = new Map<
		string,
		Set<(message: JobNotificationMessage) => void>
	>();
	subscribe(
		type: JobNotificationMessage["type"] | "*",
		listener: (message: JobNotificationMessage) => void,
	) {
		const set = this.listeners.get(type) ?? new Set();
		set.add(listener);
		this.listeners.set(type, set);
		return () => set.delete(listener);
	}
	emit(message: JobNotificationMessage) {
		for (const listener of this.listeners.get(message.type) ?? [])
			listener(message);
		for (const listener of this.listeners.get("*") ?? []) listener(message);
	}
	notifyJobEnqueued(_job: BaseJob, _target?: MessageTarget): void {}
	notifyJobUpdated(
		_jobId: string,
		_job: BaseJob,
		_target?: MessageTarget,
	): void {}
	notifyJobProgress(
		_jobId: string,
		_progress: JobProgressEvent,
		_target?: MessageTarget,
	): void {}
	notifyJobCompleted(
		_jobId: string,
		_result?: JobResult,
		_target?: MessageTarget,
	): void {}
	notifyQueueUpdated(_target?: MessageTarget): void {}
	getContextType(): ContextType {
		return "offscreen";
	}
	getStatus(): BridgeStatus {
		return { isInitialized: true, listenerCount: 0, subscribedTypes: [] };
	}
	close(): void {}
}

function job(id: string): BaseJob {
	return {
		id,
		jobType: "test",
		status: "pending",
		payload: {},
		createdAt: new Date(),
		progress: [],
	};
}

describe("RuntimeProcessor", () => {
	it("drains persisted jobs and processes direct jobs only once", async () => {
		const bridge = new FakeBridge();
		const executeJob = vi.fn(
			async (_job: BaseJob, _signal: AbortSignal) => undefined,
		);
		const processor = new RuntimeProcessor({
			notifications: bridge,
			listPendingJobs: async () => [job("persisted")],
			executeJob,
			safetyIntervalMs: 0,
		});
		await processor.start();
		const direct = job("direct");
		bridge.emit({
			type: "JOB_ENQUEUED",
			target: "offscreen",
			sender: "popup",
			timestamp: 1,
			jobId: direct.id,
			job: direct,
		});
		bridge.emit({
			type: "JOB_ENQUEUED",
			target: "offscreen",
			sender: "popup",
			timestamp: 2,
			jobId: direct.id,
			job: direct,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(executeJob.mock.calls.map(([value]) => value.id)).toEqual([
			"persisted",
			"direct",
		]);
		await processor.stop();
		expect(processor.getState()).toBe("stopped");
	});

	it("coalesces concurrent drains and cancels in-flight work on shutdown", async () => {
		const bridge = new FakeBridge();
		let observedAbort = false;
		const processor = new RuntimeProcessor({
			notifications: bridge,
			listPendingJobs: async () => [],
			executeJob: (_job, signal) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => {
						observedAbort = true;
						resolve();
					});
				}),
			safetyIntervalMs: 0,
		});
		await processor.start();
		bridge.emit({
			type: "JOB_ENQUEUED",
			target: "offscreen",
			sender: "popup",
			timestamp: 1,
			jobId: "slow",
			job: job("slow"),
		});
		await processor.stop();
		expect(observedAbort).toBe(true);
	});

	it("enters failed state when initial queue recovery fails", async () => {
		const processor = new RuntimeProcessor({
			notifications: new FakeBridge(),
			listPendingJobs: async () => {
				throw new Error("queue unavailable");
			},
			executeJob: async () => undefined,
			safetyIntervalMs: 0,
		});
		await expect(processor.start()).rejects.toThrow("queue unavailable");
		expect(processor.getState()).toBe("failed");
	});
});
