import { describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	execute: vi.fn(),
}));

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: bridge,
}));

import { LLMProxy } from "../llm-proxy";

describe("LLMProxy cancellation", () => {
	it("forwards a caller abort through the private cancellation job", async () => {
		let rejectChat: ((error: Error) => void) | undefined;
		const chatPromise = new Promise((_, reject) => {
			rejectChat = reject;
		});
		bridge.execute
			.mockResolvedValueOnce({ jobId: "chat-job", promise: chatPromise })
			.mockResolvedValueOnce({
				jobId: "cancel-job",
				promise: Promise.resolve({
					status: "completed",
					result: { canceled: true },
				}),
			});

		const proxy = new LLMProxy("local", "wllama");
		const controller = new AbortController();
		const completion = proxy.chatCompletions({
			model: "model",
			messages: [],
			stream: false,
			signal: controller.signal,
		});

		await vi.waitFor(() => expect(bridge.execute).toHaveBeenCalledTimes(1));
		controller.abort();
		await vi.waitFor(() => expect(bridge.execute).toHaveBeenCalledTimes(2));
		expect(bridge.execute).toHaveBeenNthCalledWith(
			2,
			"cancel-chat-completion",
			{ targetJobId: "chat-job" },
			{ stream: false },
		);

		rejectChat?.(new Error("Operation aborted"));
		await expect(completion).rejects.toThrow("Operation aborted");
	});
});
