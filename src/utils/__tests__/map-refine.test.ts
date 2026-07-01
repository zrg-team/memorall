import { describe, expect, it, vi } from "vitest";

import { chunkByTokens, mapRefine } from "../map-refine";

describe("map-refine utilities", () => {
	it("chunks text by estimated token budget with overlap", () => {
		expect(chunkByTokens("", { maxModelTokens: 1024 })).toEqual([]);

		const chunks = chunkByTokens("word ".repeat(1200), {
			maxModelTokens: 1200,
			maxResponseTokens: 128,
			overlapTokens: 4,
		});

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join("")).toContain("word");
	});

	it("maps chunks through the LLM and deduplicates refined results", async () => {
		const chatCompletions = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [{ message: { content: '[{"id":"a"},{"id":"b"}]' } }],
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '[{"id":"b"},{"id":"c"}]' } }],
			})
			.mockResolvedValue({
				choices: [{ message: { content: '[{"id":"c"}]' } }],
			});

		const results = await mapRefine<{ id: string }>(
			{ chatCompletions } as any,
			"system",
			(chunk, previous) => `${chunk}|previous:${previous.length}`,
			(content) => JSON.parse(content),
			"first ".repeat(300) + "second ".repeat(300),
			{
				maxModelTokens: 1000,
				maxResponseTokens: 128,
				overlapTokens: 0,
				dedupeBy: (item) => item.id,
			},
		);

		expect(results).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
		expect(chatCompletions).toHaveBeenCalledTimes(3);
	});

	it("retries failed LLM parsing before giving up", async () => {
		const onError = vi.fn(() => "return valid JSON");
		const chatCompletions = vi
			.fn()
			.mockResolvedValueOnce({
				choices: [{ message: { content: "not json" } }],
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '[{"id":"ok"}]' } }],
			});

		const results = await mapRefine<{ id: string }>(
			{ chatCompletions } as any,
			"system",
			(chunk, previous, errorContext) =>
				[chunk, previous.length, errorContext].filter(Boolean).join("|"),
			(content) => JSON.parse(content),
			"small source",
			{
				maxModelTokens: 1200,
				maxResponseTokens: 128,
				maxRetries: 1,
				onError,
			},
		);

		expect(results).toEqual([{ id: "ok" }]);
		expect(onError).toHaveBeenCalledWith(
			expect.any(SyntaxError),
			1,
			"small source",
		);
		expect(chatCompletions).toHaveBeenCalledTimes(2);
	});
});
