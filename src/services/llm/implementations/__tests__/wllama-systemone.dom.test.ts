import { describe, expect, it, vi } from "vitest";
import { WllamaLLM } from "../wllama-llm";

const model = "ggml-org/Julia-1-GGUF/Julia-1-Q8_0.gguf";
const request = {
	model,
	state: "Please refund the delivery fee.",
	questions: {
		refund: { type: "noul" as const, instructions: "Asks for money back?" },
	},
};

function adapter() {
	const llm = new WllamaLLM();
	// Access the iframe boundary without creating an actual iframe in jsdom.
	const internal = llm as any;
	internal.ready = true;
	internal.getRunnerMemoryHint = vi.fn(async () => undefined);
	internal.iframeRuntime.finishOperation = vi.fn(async () => undefined);
	const postMessage = vi.fn();
	const target = { postMessage };
	internal.iframe = { contentWindow: target };
	const reply = (messageId: string, type: string, payload: unknown) =>
		internal.onMessage({ source: target, data: { messageId, type, payload } });
	return { llm, internal, postMessage, reply };
}

describe("wllama System One adapter", () => {
	it("preserves typed probabilities and token usage through the iframe", async () => {
		const { llm, postMessage, reply } = adapter();
		const response = llm.systemOne(request);
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
		const message = postMessage.mock.calls[0][0];
		expect(message.type).toBe("systemone");
		expect(message.payload).toMatchObject(request);
		reply(message.messageId, "complete", {
			model,
			answers: { refund: { type: "noul", noul: 0.9 } },
			usage: { input_tokens: 20, output_tokens: 0 },
		});
		await expect(response).resolves.toMatchObject({
			object: "systemone",
			model,
			answers: { refund: { noul: 0.9 } },
			usage: { input_tokens: 20 },
		});
		expect(await llm.getToolCapabilities(model)).toMatchObject({
			supported: false,
		});
	});

	it("holds the operation until cancelled native inference finishes", async () => {
		const { llm, internal, postMessage, reply } = adapter();
		const controller = new AbortController();
		const response = llm.systemOne({ ...request, signal: controller.signal });
		const settled = vi.fn();
		const outcome = response.catch((error) => {
			settled();
			return error;
		});
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
		const message = postMessage.mock.calls[0][0];
		controller.abort();
		await Promise.resolve();
		expect(postMessage).toHaveBeenLastCalledWith(
			{ messageId: message.messageId, type: "abort" },
			"*",
		);
		expect(settled).not.toHaveBeenCalled();
		expect(internal.iframeRuntime.finishOperation).not.toHaveBeenCalled();
		reply(message.messageId, "error", {
			error: { message: "Operation aborted" },
		});
		expect((await outcome).message).toBe("Operation aborted");
		expect(internal.iframeRuntime.finishOperation).toHaveBeenCalledOnce();
		expect(internal.signalMap.size).toBe(0);
	});

	it("rejects an already cancelled request without dispatching inference", async () => {
		const { llm, postMessage } = adapter();
		await expect(
			llm.systemOne({ ...request, signal: AbortSignal.abort() }),
		).rejects.toThrow("Operation aborted");
		expect(postMessage).not.toHaveBeenCalled();
	});
});
