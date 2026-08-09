import { describe, expect, it, vi } from "vitest";
import { TransformerLLM } from "../transformer-llm";
import { WebLLMLLM } from "../webllm-llm";
import { WllamaLLM } from "../wllama-llm";
import { IframeRuntime } from "../iframe-runtime";

type AdapterConstructor = new () => object;

interface AdapterCase {
	name: string;
	Adapter: AdapterConstructor;
	progressEvent: string;
	chunkType: string;
	endType: string;
}

const adapters: AdapterCase[] = [
	{
		name: "Wllama",
		Adapter: WllamaLLM,
		progressEvent: "wllama:progress",
		chunkType: "stream_chunk",
		endType: "stream_end",
	},
	{
		name: "WebLLM",
		Adapter: WebLLMLLM,
		progressEvent: "webllm:progress",
		chunkType: "chunk",
		endType: "end",
	},
	{
		name: "Transformer",
		Adapter: TransformerLLM,
		progressEvent: "transformer:progress",
		chunkType: "stream_chunk",
		endType: "stream_end",
	},
];

describe("iframe request routing", () => {
	it.each(adapters)(
		"routes $name progress and streaming events to their originating request",
		({ Adapter, progressEvent, chunkType, endType }) => {
			const adapter = new Adapter() as any;
			const runnerWindow = {} as Window;
			adapter.iframe = { contentWindow: runnerWindow };

			const first = {
				resolve: vi.fn(),
				reject: vi.fn(),
				onProgress: vi.fn(),
				onStreamChunk: vi.fn(),
			};
			const second = {
				resolve: vi.fn(),
				reject: vi.fn(),
				onProgress: vi.fn(),
				onStreamChunk: vi.fn(),
			};
			adapter.pending = new Map([
				["first", first],
				["second", second],
			]);

			const receivedGlobalProgress = vi.fn();
			window.addEventListener(progressEvent, receivedGlobalProgress);

			const progress = { loaded: 1, total: 2, percent: 50 };
			adapter.onMessage({
				source: runnerWindow,
				data: { messageId: "first", type: "progress", payload: progress },
			} as MessageEvent);
			expect(first.onProgress).toHaveBeenCalledWith(progress);
			expect(second.onProgress).not.toHaveBeenCalled();
			expect(receivedGlobalProgress).toHaveBeenCalledTimes(1);

			const chunk = { choices: [{ delta: { content: "first" } }] };
			adapter.onMessage({
				source: runnerWindow,
				data: { messageId: "first", type: chunkType, payload: chunk },
			} as MessageEvent);
			expect(first.onStreamChunk).toHaveBeenCalledWith(chunk);
			expect(second.onStreamChunk).not.toHaveBeenCalled();

			adapter.onMessage({
				source: runnerWindow,
				data: { messageId: "first", type: endType, payload: chunk },
			} as MessageEvent);
			expect(first.resolve).toHaveBeenCalledWith(undefined);
			expect(second.resolve).not.toHaveBeenCalled();
			expect(adapter.pending.has("first")).toBe(false);
			expect(adapter.pending.has("second")).toBe(true);

			window.removeEventListener(progressEvent, receivedGlobalProgress);
		},
	);

	it("serializes local iframe operations", async () => {
		const runtime = new IframeRuntime({
			provider: "test",
			ensureReady: async () => undefined,
			isReady: () => true,
			destroyIframe: () => undefined,
			fetchModels: async () => ({ object: "list", data: [] }),
		});
		const events: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const first = runtime.serialize(async () => {
			events.push("first-start");
			await firstGate;
			events.push("first-end");
		});
		const second = runtime.serialize(async () => {
			events.push("second-start");
		});

		await Promise.resolve();
		expect(events).toEqual(["first-start"]);

		releaseFirst?.();
		await Promise.all([first, second]);
		expect(events).toEqual(["first-start", "first-end", "second-start"]);
	});
});
