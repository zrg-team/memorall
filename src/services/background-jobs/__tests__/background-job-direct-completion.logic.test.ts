import { describe, expect, it, vi } from "vitest";
import { BackgroundJob } from "../background-job";
import { LocalJobNotificationBridge } from "../bridges/local-runtime";
import type { BaseJob, JobProgressEvent, JobResult } from "../handlers/types";
import type { JobStore } from "../idb-job-store";

const createEmptyStore = (): JobStore => ({
	put: vi.fn(async (_job: BaseJob) => undefined),
	get: vi.fn(async (_id: string) => null),
	getAll: vi.fn(async () => []),
	delete: vi.fn(async (_id: string) => undefined),
	clearCompleted: vi.fn(async () => undefined),
});

describe("BackgroundJob direct completion", () => {
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
