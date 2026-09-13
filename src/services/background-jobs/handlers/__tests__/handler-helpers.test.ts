import { beforeEach, describe, expect, it, vi } from "vitest";

import { BaseProcessHandler } from "../base-process-handler";
import { createJobErrorMetadata, getErrorMessage } from "../error-metadata";
import { HandlerRegistry } from "../handler-registry";
import { ProcessFactory } from "../process-factory";
import { ChunkDispatcher, StreamBuffer } from "../stream-buffer";
import type { BaseJob, ItemHandlerResult, ProcessDependencies } from "../types";

const makeJob = (jobType: string): BaseJob => ({
	id: "job-1",
	jobType,
	status: "pending",
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	progress: [],
});

const makeDependencies = (): ProcessDependencies => ({
	logger: {
		info: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
		debug: vi.fn(async () => undefined),
	},
	updateJobProgress: vi.fn(async () => undefined),
	completeJob: vi.fn(async () => undefined),
});

class TestBaseHandler extends BaseProcessHandler<BaseJob> {
	async process(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		await this.addProgress(jobId, "Half", 50, dependencies, { value: 1 });
		return this.createSuccessResult({ ok: true });
	}

	fail(error: unknown): never {
		return this.createErrorResult(error);
	}

	history() {
		return this.getProgressHistory();
	}
}

describe("StreamBuffer", () => {
	it("buffers content until the minimum word threshold and flushes remaining text", () => {
		const emitted: string[] = [];
		const buffer = new StreamBuffer(3, (content) => emitted.push(content));

		buffer.add("hello ");
		buffer.add("world");
		expect(buffer.peek()).toBe("hello world");
		expect(emitted).toEqual([]);

		buffer.add(" again");
		expect(emitted).toEqual(["hello world again"]);
		expect(buffer.peek()).toBe("");

		buffer.add("tail");
		buffer.flush();
		buffer.flush();
		expect(emitted).toEqual(["hello world again", "tail"]);
	});
});

/**
 * Progress events cross an async boundary on their way to the chat UI, and the
 * first few of every turn are slower than the rest: `updateJobProgress` has to
 * look the job up before it can queue anything, then takes a fast path for
 * every later event. With emits fired and forgotten, the later events overtook
 * the early ones.
 *
 * The earliest events of a turn are the knowledge-retrieval turn, so it was
 * rebuilt at the bottom of the run timeline instead of the top — while the
 * saved message had it first. These model that latency instead of the
 * synchronous emits every other test uses, which is why it went unnoticed.
 */
describe("ChunkDispatcher ordering across async emits", () => {
	const sleep = (ms: number) =>
		new Promise((resolve) => setTimeout(resolve, ms));

	const makeDispatcher = (delivered: string[]) =>
		new ChunkDispatcher({
			intervalMs: 0,
			sendContent: async (content) => {
				delivered.push(`content:${content}`);
			},
		});

	it("delivers events in the order they were sent, even when the first is slow", async () => {
		const delivered: string[] = [];
		const dispatcher = makeDispatcher(delivered);
		let first = true;
		const emit = (label: string) => async () => {
			// The first call waits on a lookup; the rest take the fast path.
			if (first) {
				first = false;
				await sleep(20);
			}
			delivered.push(label);
		};

		dispatcher.send(emit("retrieval-call"));
		dispatcher.send(emit("retrieval-result"));
		dispatcher.send(emit("agent-tool-call"));
		dispatcher.send(emit("agent-tool-result"));
		await dispatcher.drain();

		expect(delivered).toEqual([
			"retrieval-call",
			"retrieval-result",
			"agent-tool-call",
			"agent-tool-result",
		]);
	});

	it("keeps buffered content in order with the events around it", async () => {
		const delivered: string[] = [];
		const dispatcher = makeDispatcher(delivered);

		dispatcher.send(async () => {
			await sleep(15);
			delivered.push("event-1");
		});
		dispatcher.queueContent("hello");
		dispatcher.send(async () => {
			delivered.push("event-2");
		});
		await dispatcher.drain();

		expect(delivered).toEqual(["event-1", "content:hello", "event-2"]);
	});

	it("keeps going after an emit fails, without reordering the rest", async () => {
		// One failed progress write must not wedge the queue and swallow every
		// chunk after it.
		const delivered: string[] = [];
		const dispatcher = makeDispatcher(delivered);

		dispatcher.send(async () => {
			throw new Error("write failed");
		});
		dispatcher.send(async () => {
			delivered.push("after-failure");
		});
		await dispatcher.drain();

		expect(delivered).toEqual(["after-failure"]);
	});

	it("never lets a stuck write hold the end of a turn", async () => {
		// A progress write that never settles must not stop the turn from
		// finishing — the user would be left watching it run forever.
		const dispatcher = makeDispatcher([]);
		dispatcher.send(() => new Promise<void>(() => {}));

		const started = Date.now();
		await dispatcher.drain(50);

		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it("does not wait at all when nothing is still being written", async () => {
		// The common case: synchronous writes leave nothing in flight, so ending
		// a turn costs nothing.
		const delivered: string[] = [];
		const dispatcher = new ChunkDispatcher({
			intervalMs: 0,
			sendContent: (content) => {
				delivered.push(content);
			},
		});
		dispatcher.send(() => {
			delivered.push("sync-event");
		});

		const started = performance.now();
		await dispatcher.drain();

		expect(performance.now() - started).toBeLessThan(20);
		expect(delivered).toEqual(["sync-event"]);
	});

	it("lets the end of a turn wait for everything already sent", async () => {
		const delivered: string[] = [];
		const dispatcher = makeDispatcher(delivered);

		dispatcher.send(async () => {
			await sleep(20);
			delivered.push("last-chunk");
		});
		await dispatcher.drain();
		// Anything sent after draining — the final result — comes after it.
		delivered.push("final");

		expect(delivered).toEqual(["last-chunk", "final"]);
	});
});

describe("ChunkDispatcher", () => {
	const createHarness = () => {
		const sent: string[] = [];
		let now = 1_000;
		let scheduled: { fn: () => void; delayMs: number } | null = null;

		const dispatcher = new ChunkDispatcher({
			intervalMs: 40,
			sendContent: (content) => {
				sent.push(content);
			},
			now: () => now,
			schedule: (fn, delayMs) => {
				scheduled = { fn, delayMs };
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			cancel: () => {
				scheduled = null;
			},
		});

		return {
			dispatcher,
			sent,
			advance: (ms: number) => {
				now += ms;
			},
			runTimer: () => {
				const pending = scheduled;
				scheduled = null;
				pending?.fn();
			},
			pendingDelay: () => scheduled?.delayMs,
		};
	};

	it("sends the first fragment immediately and merges the rest of the window", () => {
		const { dispatcher, sent, advance, runTimer, pendingDelay } =
			createHarness();

		dispatcher.queueContent("Hello");
		expect(sent).toEqual(["Hello"]);

		advance(10);
		dispatcher.queueContent(" there");
		advance(10);
		dispatcher.queueContent(" world");
		// Still one message on the wire: both fragments landed inside the window.
		expect(sent).toEqual(["Hello"]);
		expect(pendingDelay()).toBe(30);

		runTimer();
		expect(sent).toEqual(["Hello", " there world"]);
	});

	it("sends again immediately once the window has elapsed", () => {
		const { dispatcher, sent, advance } = createHarness();

		dispatcher.queueContent("one");
		advance(40);
		dispatcher.queueContent("two");

		expect(sent).toEqual(["one", "two"]);
	});

	it("flushes buffered content before an out-of-band event", () => {
		const { dispatcher, sent, advance } = createHarness();
		const order: string[] = [];

		dispatcher.queueContent("first");
		order.push(...sent.splice(0));

		advance(5);
		dispatcher.queueContent(" tail");
		expect(dispatcher.hasPending()).toBe(true);

		dispatcher.send(() => {
			order.push("tool-call");
		});

		expect(sent).toEqual([" tail"]);
		expect(order).toEqual(["first", "tool-call"]);
		expect(dispatcher.hasPending()).toBe(false);
	});

	it("drops the pending timer when flushed so no update outlives the turn", () => {
		const { dispatcher, sent, advance, pendingDelay } = createHarness();

		dispatcher.queueContent("a");
		advance(5);
		dispatcher.queueContent("b");
		expect(pendingDelay()).toBe(35);

		dispatcher.flush();
		expect(sent).toEqual(["a", "b"]);
		expect(pendingDelay()).toBeUndefined();

		dispatcher.flush();
		expect(sent).toEqual(["a", "b"]);
	});
});

describe("job error metadata", () => {
	it("extracts messages, HTTP status, provider metadata, and user IDs", () => {
		const metadata = createJobErrorMetadata(
			new Error(
				'Request failed: 429 {"error":{"message":"Rate limited","code":"rate_limit","metadata":{"provider_name":"openai"}},"user_id":"user-1"}',
			),
		);

		expect(metadata).toEqual({
			message: "Rate limited",
			rawMessage: expect.stringContaining("Request failed: 429"),
			statusCode: 429,
			code: "rate_limit",
			providerName: "openai",
			userId: "user-1",
		});
		expect(getErrorMessage("plain")).toBe("plain");
		expect(createJobErrorMetadata({ reason: "x" }).message).toBe(
			"[object Object]",
		);
	});
});

describe("BaseProcessHandler", () => {
	it("records progress and returns success results", async () => {
		const dependencies = makeDependencies();
		const handler = new TestBaseHandler();

		await expect(
			handler.process("job-1", makeJob("base-test"), dependencies),
		).resolves.toEqual({ ok: true });

		expect(dependencies.updateJobProgress).toHaveBeenCalledWith(
			"job-1",
			expect.objectContaining({
				stage: "Half",
				progress: 50,
				metadata: { value: 1 },
			}),
		);
		expect(handler.history()).toHaveLength(1);
	});

	it("throws normalized errors from createErrorResult", () => {
		const handler = new TestBaseHandler();

		expect(() => handler.fail(new Error("bad"))).toThrow("bad");
		expect(() => handler.fail("bad string")).toThrow("bad string");
	});
});

describe("HandlerRegistry", () => {
	it("registers one handler for multiple job types", () => {
		const registry = HandlerRegistry.getInstance();
		const handler = { process: vi.fn() };
		const jobTypes = [
			`helper-test-${Date.now()}-a`,
			`helper-test-${Date.now()}-b`,
		];

		registry.register({ instance: handler as any, jobs: jobTypes });

		expect(registry.getHandler(jobTypes[0])).toBe(handler);
		expect(registry.getHandler(jobTypes[1])).toBe(handler);
		expect(registry.getRegisteredJobTypes()).toEqual(
			expect.arrayContaining(jobTypes),
		);
		expect(() => registry.getHandler(`missing-${Date.now()}`)).toThrow(
			"No handler registered for job type",
		);
	});
});

describe("ProcessFactory", () => {
	const jobType = "factory-helper-test";

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("executes registered handlers and completes successful jobs", async () => {
		const factory = ProcessFactory.getInstance();
		const dependencies = makeDependencies();
		const handler = {
			process: vi.fn(async () => ({ output: "done" })),
		};

		factory.setDependencies(dependencies);
		factory.register({ instance: handler as any, jobs: [jobType] });

		await factory.executeJob("job-1", makeJob(jobType));

		expect(dependencies.updateJobProgress).toHaveBeenNthCalledWith(
			1,
			"job-1",
			expect.objectContaining({ stage: "Starting...", status: "processing" }),
		);
		expect(dependencies.updateJobProgress).toHaveBeenNthCalledWith(
			2,
			"job-1",
			expect.objectContaining({
				stage: "Completed successfully",
				status: "completed",
				result: { output: "done" },
			}),
		);
		expect(dependencies.completeJob).toHaveBeenCalledWith(
			"job-1",
			expect.objectContaining({
				status: "completed",
				result: { output: "done" },
			}),
		);
		expect(dependencies.logger.info).toHaveBeenCalled();
	});

	it("records failed jobs with structured error metadata", async () => {
		const factory = ProcessFactory.getInstance();
		const dependencies = makeDependencies();
		const handler = {
			process: vi.fn(async () => {
				throw new Error('Request failed: 500 {"error":{"message":"broken"}}');
			}),
		};
		const failingJobType = `${jobType}-failed`;

		factory.setDependencies(dependencies);
		factory.register({ instance: handler as any, jobs: [failingJobType] });

		await factory.executeJob("job-2", makeJob(failingJobType));

		expect(dependencies.logger.error).toHaveBeenCalledWith(
			"💥 Unexpected error in job: job-2",
			expect.any(Error),
			"offscreen",
		);
		expect(dependencies.completeJob).toHaveBeenCalledWith(
			"job-2",
			expect.objectContaining({
				status: "failed",
				error: expect.stringContaining("Request failed: 500"),
				result: {
					error: expect.objectContaining({
						message: "broken",
						statusCode: 500,
					}),
				},
			}),
		);
	});

	it("requires dependencies before executing jobs and creates dependency adapters", async () => {
		const factory = ProcessFactory.getInstance();
		const deps = ProcessFactory.createDependencies(vi.fn(), vi.fn());

		expect(deps.logger.info).toEqual(expect.any(Function));
		factory.setDependencies(undefined as any);

		await expect(factory.executeJob("job-3", makeJob(jobType))).rejects.toThrow(
			"ProcessFactory dependencies not set",
		);
	});
});
