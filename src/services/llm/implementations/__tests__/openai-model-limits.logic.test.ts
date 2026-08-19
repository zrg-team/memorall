import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAILLM } from "../openai-llm";

/**
 * `WELL_KNOWN_MODELS` only covers models someone thought to add, so every
 * aggregator model outside it used to fall back to a 10K context window. The
 * agent then budgeted against a limit an order of magnitude below the truth —
 * an OpenRouter Qwen 3 model reported "4K of 10K tokens" when its real window is
 * 262144. These tests pin the fix: whatever the provider reports wins.
 */

const mockModelsResponse = (entries: unknown[]) => {
	const fetchMock = vi.fn(async () => ({
		ok: true,
		status: 200,
		statusText: "OK",
		json: async () => ({ data: entries }),
	}));
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OpenAI-compatible model limits", () => {
	it("uses the context window the provider reports for an unrecognised model", async () => {
		mockModelsResponse([
			{
				id: "qwen/qwen3.8-27b",
				context_length: 262144,
				top_provider: { max_completion_tokens: 32768 },
			},
		]);
		const llm = new OpenAILLM("key", "https://openrouter.test/api/v1");

		await expect(llm.getMaxModelTokens("qwen/qwen3.8-27b")).resolves.toBe(
			262144,
		);
		await expect(llm.getMaxResponseTokens("qwen/qwen3.8-27b")).resolves.toBe(
			32768,
		);
	});

	it("leaves room for a reply when only the window is reported", async () => {
		mockModelsResponse([{ id: "some/model", context_length: 40000 }]);
		const llm = new OpenAILLM("key", "https://openrouter.test/api/v1");

		await expect(llm.getMaxModelTokens("some/model")).resolves.toBe(40000);
		await expect(llm.getMaxResponseTokens("some/model")).resolves.toBe(20000);
	});

	it("never lets the reply budget exceed the context window", async () => {
		mockModelsResponse([
			{
				id: "odd/model",
				context_length: 8192,
				top_provider: { max_completion_tokens: 999999 },
			},
		]);
		const llm = new OpenAILLM("key", "https://openrouter.test/api/v1");

		await expect(llm.getMaxResponseTokens("odd/model")).resolves.toBe(8192);
	});

	it("reads the vLLM and generic spellings of the window", async () => {
		mockModelsResponse([
			{ id: "vllm/model", max_model_len: 65536 },
			{ id: "generic/model", context_window: 16384 },
		]);
		const llm = new OpenAILLM("key", "https://gateway.test/v1");

		await expect(llm.getMaxModelTokens("vllm/model")).resolves.toBe(65536);
		await expect(llm.getMaxModelTokens("generic/model")).resolves.toBe(16384);
	});

	it("falls back to the built-in table when the listing omits limits", async () => {
		mockModelsResponse([{ id: "gpt-4o" }]);
		const llm = new OpenAILLM("key", "https://openai.test/v1");

		await expect(llm.getMaxModelTokens("gpt-4o")).resolves.toBe(128000);
	});

	it("stays conservative when nothing knows the model", async () => {
		mockModelsResponse([{ id: "mystery/model" }]);
		const llm = new OpenAILLM("key", "https://gateway.test/v1");

		await expect(llm.getMaxModelTokens("mystery/model")).resolves.toBe(10000);
	});

	it("survives a listing endpoint that is unavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			}),
		);
		const llm = new OpenAILLM("key", "https://gateway.test/v1");

		await expect(llm.getMaxModelTokens("gpt-4o")).resolves.toBe(128000);
	});

	it("fetches the listing once and serves later lookups from cache", async () => {
		const fetchMock = mockModelsResponse([
			{ id: "a/model", context_length: 1000 },
			{ id: "b/model", context_length: 2000 },
		]);
		const llm = new OpenAILLM("key", "https://gateway.test/v1");

		await expect(llm.getMaxModelTokens("a/model")).resolves.toBe(1000);
		await expect(llm.getMaxModelTokens("b/model")).resolves.toBe(2000);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
