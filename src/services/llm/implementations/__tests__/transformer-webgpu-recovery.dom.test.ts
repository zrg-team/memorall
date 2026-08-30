import { describe, expect, it, vi } from "vitest";
import { TransformerLLM } from "../transformer-llm";
import { WEBGPU_CONTEXT_LOST_CODE } from "../../utils/webgpu-runner-errors";
import type { ChatCompletionChunk } from "@/types/openai";

const MODEL = "LiquidAI/LFM2-8B-A1B-ONNX";

function contextLostError(): Error {
	return Object.assign(
		new Error(
			"Chat completion failed: failed to call OrtRun(). Status Message: Failed to create a WebGPU compute pipeline: A valid external Instance reference no longer exists.",
		),
		{ code: WEBGPU_CONTEXT_LOST_CODE },
	);
}

function chunk(
	content: string,
	finishReason: "stop" | null = null,
): ChatCompletionChunk {
	return {
		id: "chatcmpl-test",
		object: "chat.completion.chunk",
		created: 0,
		model: MODEL,
		choices: [
			{
				index: 0,
				delta: content ? { content } : {},
				finish_reason: finishReason,
			},
		],
	} as ChatCompletionChunk;
}

/**
 * Builds an adapter whose runner iframe is faked out: `send` is scripted, and
 * the iframe lifecycle is recorded rather than performed.
 */
function createAdapter(send: (...args: any[]) => Promise<unknown>) {
	const adapter = new TransformerLLM("about:blank") as any;
	const lifecycle: string[] = [];

	adapter.ready = true;
	adapter.send = vi.fn(send);
	adapter.getSystemSpecs = vi.fn(async () => null);
	adapter.destroy = vi.fn(() => {
		lifecycle.push("destroy");
		adapter.ready = false;
	});
	adapter.initialize = vi.fn(async () => {
		// Mirrors the real guard, so only an actual recreation is recorded.
		if (adapter.ready) return;
		lifecycle.push("initialize");
		adapter.ready = true;
	});
	adapter.serve = vi.fn(async (model: string) => {
		lifecycle.push(`serve:${model}`);
	});

	return { adapter, lifecycle };
}

describe("transformer runner WebGPU context loss", () => {
	it("recreates the runner and replays a streaming request", async () => {
		let attempts = 0;
		const { adapter, lifecycle } = createAdapter(
			async (type: string, _payload: unknown, options: any) => {
				if (type !== "chat/completions") return {};
				attempts += 1;
				if (attempts === 1) throw contextLostError();
				options.onStreamChunk(chunk("hello"));
				options.onStreamChunk(chunk("", "stop"));
				return undefined;
			},
		);

		const received: string[] = [];
		for await (const streamed of adapter.chatCompletions({
			model: MODEL,
			messages: [{ role: "user", content: "hi" }],
			stream: true,
		})) {
			const content = streamed.choices[0]?.delta?.content;
			if (content) received.push(content);
		}

		expect(received).toEqual(["hello"]);
		expect(attempts).toBe(2);
		// A dead device outlives every model the runner reloads, so recovery has
		// to replace the document and serve the model into the replacement.
		expect(lifecycle).toEqual(["destroy", "initialize", `serve:${MODEL}`]);
	});

	it("recreates the runner and replays a non-streaming request", async () => {
		let attempts = 0;
		const { adapter, lifecycle } = createAdapter(async (type: string) => {
			if (type !== "chat/completions") return {};
			attempts += 1;
			if (attempts === 1) throw contextLostError();
			return {
				id: "chatcmpl-test",
				object: "chat.completion",
				created: 0,
				model: MODEL,
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "hello" },
						finish_reason: "stop",
					},
				],
			};
		});

		const response = await adapter.chatCompletions({
			model: MODEL,
			messages: [{ role: "user", content: "hi" }],
		});

		expect(response.choices[0].message.content).toBe("hello");
		expect(lifecycle).toEqual(["destroy", "initialize", `serve:${MODEL}`]);
	});

	it("gives up after one replay instead of looping", async () => {
		let attempts = 0;
		const { adapter, lifecycle } = createAdapter(async (type: string) => {
			if (type !== "chat/completions") return {};
			attempts += 1;
			throw contextLostError();
		});

		await expect(
			adapter.chatCompletions({
				model: MODEL,
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toThrow(/valid external Instance reference/);

		expect(attempts).toBe(2);
		expect(lifecycle).toEqual(["destroy", "initialize", `serve:${MODEL}`]);
	});

	it("does not replay once tokens have reached the caller", async () => {
		let attempts = 0;
		const { adapter, lifecycle } = createAdapter(
			async (type: string, _payload: unknown, options: any) => {
				if (type !== "chat/completions") return {};
				attempts += 1;
				options.onStreamChunk(chunk("partial"));
				await new Promise((resolve) => setTimeout(resolve, 20));
				throw contextLostError();
			},
		);

		const received: string[] = [];
		await expect(
			(async () => {
				for await (const streamed of adapter.chatCompletions({
					model: MODEL,
					messages: [{ role: "user", content: "hi" }],
					stream: true,
				})) {
					const content = streamed.choices[0]?.delta?.content;
					if (content) received.push(content);
				}
			})(),
		).rejects.toThrow(/valid external Instance reference/);

		expect(received).toEqual(["partial"]);
		expect(attempts).toBe(1);
		expect(lifecycle).toEqual([]);
	});

	it("passes ordinary failures straight through", async () => {
		let attempts = 0;
		const { adapter, lifecycle } = createAdapter(async (type: string) => {
			if (type !== "chat/completions") return {};
			attempts += 1;
			throw new Error("Prompt is too long for the model context window");
		});

		await expect(
			adapter.chatCompletions({
				model: MODEL,
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toThrow(/Prompt is too long/);

		expect(attempts).toBe(1);
		expect(lifecycle).toEqual([]);
	});
});

describe("transformer model loading after context loss", () => {
	it("recreates the runner and loads the model again", async () => {
		let serves = 0;
		const { adapter, lifecycle } = createAdapter(async (type: string) => {
			if (type === "models") return { object: "list", data: [] };
			if (type !== "serve") return {};
			serves += 1;
			// The runner reports a load failure, not a completion failure, so this
			// one is recognised by its message rather than by a code.
			if (serves === 1) {
				throw new Error(
					"Failed to load model: A valid external Instance reference no longer exists.",
				);
			}
			return { id: MODEL, object: "model", loaded: true, downloaded: true };
		});
		// `serve` is the method under test here, so restore the real one.
		delete adapter.serve;

		const modelInfo = await adapter.serve(MODEL);

		expect(modelInfo.loaded).toBe(true);
		expect(serves).toBe(2);
		// No `serve:` entry - recovery must not recurse back into serve, which is
		// the caller that retries.
		expect(lifecycle).toEqual(["destroy", "initialize"]);
	});
});
