import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeRuntimeBridge } from "../chrome-runtime";
import type { JobNotificationMessage } from "../types";

type RuntimeListener = (
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response?: unknown) => void,
) => boolean | undefined;

const job = {
	id: "chat-retry-job",
	jobType: "chat",
	status: "pending" as const,
	payload: {},
	createdAt: new Date(),
	progress: [],
};

describe("ChromeRuntimeBridge", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries a direct offscreen job until its consumer acknowledges it", async () => {
		const listeners: RuntimeListener[] = [];
		let deliveryAttempt = 0;
		const sendMessage = vi.fn(async (message: JobNotificationMessage) => {
			deliveryAttempt += 1;
			if (deliveryAttempt === 1) return undefined;
			let response: unknown;
			for (const listener of listeners) {
				listener(message, {}, (value) => {
					response = value;
				});
			}
			return response;
		});
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: {
					addListener: (listener: RuntimeListener) => listeners.push(listener),
				},
				sendMessage,
			},
		});

		const receiver = new ChromeRuntimeBridge("offscreen");
		const accepted = vi.fn();
		receiver.subscribe("JOB_ENQUEUED", accepted);
		const sender = new ChromeRuntimeBridge("popup");

		await sender.notifyJobEnqueued(job);

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(accepted).toHaveBeenCalledTimes(1);
		expect(accepted).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "JOB_ENQUEUED",
				jobId: job.id,
				target: "offscreen",
			}),
		);
	});
});

const createBridgeHarness = (context: "popup" | "offscreen") => {
	const listeners: RuntimeListener[] = [];
	const sent: JobNotificationMessage[] = [];
	vi.stubGlobal("chrome", {
		runtime: {
			onMessage: {
				addListener: (listener: RuntimeListener) => listeners.push(listener),
			},
			sendMessage: vi.fn(async (message: JobNotificationMessage) => {
				sent.push(message);
				return undefined;
			}),
		},
	});
	const bridge = new ChromeRuntimeBridge(context);
	const emit = (message: JobNotificationMessage) => {
		for (const listener of listeners) listener(message, {}, () => undefined);
	};
	return { bridge, emit, sent };
};

describe("duplicate delivery", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("dispatches a notification once even when it arrives twice", () => {
		const { bridge, emit } = createBridgeHarness("popup");
		const seen: string[] = [];
		bridge.subscribe("JOB_PROGRESS", (message) => {
			seen.push(message.progress?.stage ?? "");
		});

		// An extension page open in a tab can be reached directly AND by the
		// background relay. Appending the same delta twice is what interleaves
		// the assistant's text with itself.
		const message: JobNotificationMessage = {
			type: "JOB_PROGRESS",
			target: "all",
			sender: "offscreen",
			timestamp: 1,
			jobId: "job-1",
			messageId: "abc:1",
			progress: { stage: "chunk-a", progress: 10, status: "processing" },
		};
		emit(message);
		emit(message);

		expect(seen).toEqual(["chunk-a"]);
	});

	it("still delivers distinct notifications sent in the same millisecond", () => {
		const { bridge, emit } = createBridgeHarness("popup");
		const seen: string[] = [];
		bridge.subscribe("JOB_PROGRESS", (message) => {
			seen.push(message.progress?.stage ?? "");
		});

		for (const [index, stage] of ["chunk-a", "chunk-b"].entries()) {
			emit({
				type: "JOB_PROGRESS",
				target: "all",
				sender: "offscreen",
				timestamp: 1,
				jobId: "job-1",
				messageId: `abc:${index + 1}`,
				progress: { stage, progress: 10, status: "processing" },
			});
		}

		expect(seen).toEqual(["chunk-a", "chunk-b"]);
	});

	it("gives every outgoing message a distinct id", () => {
		const { bridge, sent } = createBridgeHarness("offscreen");
		bridge.notifyJobProgress(
			"job-1",
			{ stage: "a", progress: 1, status: "processing" },
			"all",
		);
		bridge.notifyJobProgress(
			"job-1",
			{ stage: "b", progress: 2, status: "processing" },
			"all",
		);

		const ids = sent.map((message) => message.messageId);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});
});
