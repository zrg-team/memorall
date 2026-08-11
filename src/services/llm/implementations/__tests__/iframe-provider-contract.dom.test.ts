import { describe, expect, it, vi } from "vitest";
import { NATIVE_TOOL_SUPPORT } from "../../interfaces/tool-capability";
import { TransformerLLM } from "../transformer-llm";
import { WebLLMLLM } from "../webllm-llm";
import { WllamaLLM } from "../wllama-llm";

type LocalAdapter = WllamaLLM | WebLLMLLM | TransformerLLM;

interface AdapterCase {
	name: "Wllama" | "WebLLM" | "Transformer";
	create: () => LocalAdapter;
	chunkType: "stream_chunk" | "chunk";
	endType: "stream_end" | "end";
}

const adapters: AdapterCase[] = [
	{
		name: "Wllama",
		create: () => new WllamaLLM(),
		chunkType: "stream_chunk",
		endType: "stream_end",
	},
	{
		name: "WebLLM",
		create: () => new WebLLMLLM(),
		chunkType: "chunk",
		endType: "end",
	},
	{
		name: "Transformer",
		create: () => new TransformerLLM(),
		chunkType: "stream_chunk",
		endType: "stream_end",
	},
];

function installRunner(
	adapter: LocalAdapter,
	chunkType: AdapterCase["chunkType"],
	endType: AdapterCase["endType"],
	respond = true,
) {
	const localAdapter = adapter as any;
	const runnerWindow = {
		postMessage: vi.fn(
			(message: { messageId: string; type: string; payload?: any }) => {
				if (message.type !== "chat/completions") return;
				if (!respond) return;

				queueMicrotask(() => {
					if (message.payload?.stream) {
						localAdapter.onMessage({
							source: runnerWindow,
							data: {
								messageId: message.messageId,
								type: chunkType,
								payload: {
									id: "stream-chunk",
									object: "chat.completion.chunk",
									created: 1,
									model: "contract-model",
									choices: [
										{
											index: 0,
											delta: { content: "streamed" },
											finish_reason: null,
										},
									],
								},
							},
						} as unknown as MessageEvent);
						localAdapter.onMessage({
							source: runnerWindow,
							data: {
								messageId: message.messageId,
								type: endType,
								payload: {
									id: "stream-end",
									object: "chat.completion.chunk",
									created: 1,
									model: "contract-model",
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: "stop",
										},
									],
								},
							},
						} as unknown as MessageEvent);
						return;
					}

					localAdapter.onMessage({
						source: runnerWindow,
						data: {
							messageId: message.messageId,
							type: "complete",
							payload: {
								id: "completion",
								object: "chat.completion",
								created: 1,
								model: "contract-model",
								choices: [
									{
										index: 0,
										message: { role: "assistant", content: "completed" },
										finish_reason: "stop",
									},
								],
							},
						},
					} as unknown as MessageEvent);
				});
			},
		),
	};

	localAdapter.ready = true;
	localAdapter.iframe = { contentWindow: runnerWindow };
	localAdapter.getToolCapabilities = vi.fn(async () => NATIVE_TOOL_SUPPORT);
	localAdapter.withRunnerMemoryHint = vi.fn(
		async (payload: unknown) => payload,
	);

	return runnerWindow;
}

describe("local iframe provider contracts", () => {
	it.each(adapters)(
		"$name completes and streams through its runner protocol",
		async ({ create, chunkType, endType }) => {
			const adapter = create();
			const runnerWindow = installRunner(adapter, chunkType, endType);

			const completion = await adapter.chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: false,
			});
			expect(completion.choices[0]?.message.content).toBe("completed");

			const chunks = [];
			for await (const chunk of adapter.chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: true,
			})) {
				chunks.push(chunk);
			}
			expect(chunks.map((chunk) => chunk.choices[0]?.delta.content)).toContain(
				"streamed",
			);
			expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");
			expect(runnerWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ type: "chat/completions" }),
				"*",
			);
		},
	);

	it.each(adapters)(
		"$name relays caller cancellation to its runner",
		async ({ create, chunkType, endType }) => {
			const adapter = create();
			const runnerWindow = installRunner(adapter, chunkType, endType, false);
			const controller = new AbortController();

			const completion = adapter.chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: false,
				signal: controller.signal,
			});
			await vi.waitFor(() =>
				expect(runnerWindow.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({ type: "chat/completions" }),
					"*",
				),
			);

			controller.abort();
			await expect(completion).rejects.toThrow("Operation aborted");
			expect(runnerWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ type: "abort" }),
				"*",
			);
		},
	);
});
