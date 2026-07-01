import { describe, expect, it, vi } from "vitest";

import {
	cleanJSONResponse,
	createChunks,
	processInChunks,
	processWithLLMChunks,
	safeParseJSON,
} from "../chunking";

describe("chunking utilities", () => {
	it("splits arrays into fixed-size chunks", () => {
		expect(createChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(createChunks([], 3)).toEqual([]);
	});

	it("processes chunks with concurrency and collects failures", async () => {
		const calls: Array<{ chunk: number[]; index: number }> = [];

		const result = await processInChunks(
			[1, 2, 3, 4, 5],
			async (chunk, index) => {
				calls.push({ chunk, index });
				if (index === 1) throw new Error("bad chunk");
				return chunk.map((value) => value * 2);
			},
			{ chunkSize: 2, maxConcurrency: 2 },
		);

		expect(calls).toEqual([
			{ chunk: [1, 2], index: 0 },
			{ chunk: [3, 4], index: 1 },
			{ chunk: [5], index: 2 },
		]);
		expect(result.results).toEqual([2, 4, 10]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].message).toBe("bad chunk");
		expect(result.chunksProcessed).toBe(3);
		expect(result.totalProcessingTime).toEqual(expect.any(Number));
	});

	it("processes LLM chunks and parses each response", async () => {
		const chatCompletions = vi.fn(async () => ({
			choices: [{ message: { content: "[10,20]" } }],
		}));

		const result = await processWithLLMChunks<number, number>(
			[1, 2, 3],
			{
				llm: {
					isReady: () => true,
					chatCompletions,
				},
			} as any,
			{
				systemPrompt: "system",
				generatePrompt: (items) => `items: ${items.join(",")}`,
				parseResponse: (response) => JSON.parse(response),
				llmOptions: { temperature: 0.2 },
			},
			{ chunkSize: 2, maxConcurrency: 1 },
		);

		expect(chatCompletions).toHaveBeenCalledWith({
			messages: [
				{ role: "system", content: "system" },
				{ role: "user", content: "items: 1,2" },
			],
			temperature: 0.2,
			stream: false,
		});
		expect(result.results).toEqual([10, 20, 10, 20]);
	});

	it("rejects LLM chunking when the service is not ready", async () => {
		await expect(
			processWithLLMChunks([1], { llm: { isReady: () => false } } as any, {
				systemPrompt: "",
				generatePrompt: () => "",
				parseResponse: () => [],
			}),
		).rejects.toThrow("LLM service is not ready");
	});

	it("cleans markdown JSON fences and safely falls back on parse errors", () => {
		expect(cleanJSONResponse('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
		expect(cleanJSONResponse("```\n[1]\n```")).toBe("[1]");
		expect(safeParseJSON('```json\n{"ok":true}\n```', { ok: false })).toEqual({
			ok: true,
		});
		expect(safeParseJSON("not json", { ok: false })).toEqual({ ok: false });
	});
});
