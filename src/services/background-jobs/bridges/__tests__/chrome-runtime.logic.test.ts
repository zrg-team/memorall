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
