import { describe, expect, it } from "vitest";

import {
	addTokenUsage,
	chunkHasFinishReason,
	createAggregatedTokenUsage,
	estimatePromptTokens,
	extractChunkOutputText,
	extractResponseOutputText,
	getCacheHitRatio,
	mergeTokenUsage,
	normalizeTokenUsage,
	resolveTokenUsage,
} from "../llm/utils/token-usage";

describe("LLM token usage utilities", () => {
	it("normalizes valid usage and rejects invalid usage", () => {
		expect(
			normalizeTokenUsage({
				prompt_tokens: 2,
				completion_tokens: 3,
				total_tokens: 4,
			}),
		).toEqual({ prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 });
		expect(normalizeTokenUsage(null)).toBeUndefined();
		expect(
			normalizeTokenUsage({
				prompt_tokens: -1,
				completion_tokens: 0,
				total_tokens: 0,
			}),
		).toBeUndefined();
	});

	it("estimates prompt tokens across text, image, tool, and named messages", () => {
		const tokens = estimatePromptTokens([
			{ role: "system", content: "You are helpful" },
			{
				role: "user",
				name: "alice",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,x" } },
				],
			},
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call-1",
						type: "function",
						function: { name: "search", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "call-1", content: "result" },
		] as any);

		expect(tokens).toBeGreaterThan(20);
		expect(estimatePromptTokens([])).toBe(0);
	});

	it("extracts output text from responses and stream chunks", () => {
		expect(
			extractResponseOutputText({
				choices: [
					{ message: { content: "answer" } },
					{
						message: {
							content: "",
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: { name: "tool", arguments: "{}" },
								},
							],
						},
					},
				],
			} as any),
		).toContain("answer");

		expect(
			extractChunkOutputText({
				choices: [
					{ delta: { content: "part" } },
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call-1",
									type: "function",
									function: { name: "tool", arguments: "{}" },
								},
							],
						},
					},
				],
			} as any),
		).toContain("part");
		expect(
			chunkHasFinishReason({ choices: [{ finish_reason: null }] } as any),
		).toBe(false);
		expect(
			chunkHasFinishReason({ choices: [{ finish_reason: "stop" }] } as any),
		).toBe(true);
	});

	it("uses supplied usage when valid and estimates missing usage", () => {
		expect(
			resolveTokenUsage(
				{ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
				[],
				"",
			),
		).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });

		expect(
			resolveTokenUsage(
				undefined,
				[{ role: "user", content: "hello" }] as any,
				"ok",
			),
		).toEqual({
			prompt_tokens: expect.any(Number),
			completion_tokens: 1,
			total_tokens: expect.any(Number),
			estimated: true,
		});
	});
});

describe("LLM token usage cache accounting", () => {
	it("flattens OpenAI and OpenRouter cache details", () => {
		expect(
			normalizeTokenUsage({
				prompt_tokens: 1000,
				completion_tokens: 50,
				total_tokens: 1050,
				prompt_tokens_details: { cached_tokens: 896, cache_write_tokens: 104 },
				completion_tokens_details: { reasoning_tokens: 12 },
				cost: 0.002,
			} as never),
		).toEqual({
			prompt_tokens: 1000,
			completion_tokens: 50,
			total_tokens: 1050,
			cached_tokens: 896,
			cache_write_tokens: 104,
			reasoning_tokens: 12,
			cost: 0.002,
		});
	});

	it("reads Anthropic-style cache counters and clamps reads to the prompt", () => {
		expect(
			normalizeTokenUsage({
				prompt_tokens: 500,
				completion_tokens: 10,
				total_tokens: 510,
				cache_read_input_tokens: 800,
				cache_creation_input_tokens: 30,
			} as never),
		).toMatchObject({ cached_tokens: 500, cache_write_tokens: 30 });
	});

	it("keeps already-flattened fields when a usage is normalized twice", () => {
		const once = normalizeTokenUsage({
			prompt_tokens: 100,
			completion_tokens: 5,
			total_tokens: 105,
			prompt_tokens_details: { cached_tokens: 64 },
		} as never);
		expect(normalizeTokenUsage(once)).toEqual(once);
		expect(
			normalizeTokenUsage({
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
				estimated: true,
			}),
		).toMatchObject({ estimated: true });
	});

	it("flags locally estimated usage", () => {
		expect(
			resolveTokenUsage(undefined, [{ role: "user", content: "hello" }], "hi"),
		).toMatchObject({ estimated: true });
	});

	it("computes the cache hit ratio only when the provider reported one", () => {
		expect(getCacheHitRatio(undefined)).toBeUndefined();
		expect(
			getCacheHitRatio({ prompt_tokens: 100, cached_tokens: undefined }),
		).toBeUndefined();
		expect(getCacheHitRatio({ prompt_tokens: 200, cached_tokens: 150 })).toBe(
			0.75,
		);
		expect(getCacheHitRatio({ prompt_tokens: 0, cached_tokens: 0 })).toBe(0);
	});

	it("sums usage across an agent turn and keeps the per-request breakdown", () => {
		let total = createAggregatedTokenUsage();
		total = addTokenUsage(total, {
			prompt_tokens: 1000,
			completion_tokens: 20,
			total_tokens: 1020,
			cached_tokens: 0,
			cache_write_tokens: 1000,
		});
		total = addTokenUsage(total, {
			prompt_tokens: 1100,
			completion_tokens: 30,
			total_tokens: 1130,
			cached_tokens: 1000,
			cost: 0.001,
		});

		expect(total).toEqual({
			prompt_tokens: 2100,
			completion_tokens: 50,
			total_tokens: 2150,
			cached_tokens: 1000,
			cache_write_tokens: 1000,
			cost: 0.001,
			requests: 2,
			calls: [
				{
					prompt_tokens: 1000,
					completion_tokens: 20,
					total_tokens: 1020,
					cached_tokens: 0,
					cache_write_tokens: 1000,
				},
				{
					prompt_tokens: 1100,
					completion_tokens: 30,
					total_tokens: 1130,
					cached_tokens: 1000,
					cost: 0.001,
				},
			],
		});
		expect(getCacheHitRatio(total)).toBeCloseTo(1000 / 2100);
	});

	it("does not invent cache fields when no request reported them", () => {
		const merged = mergeTokenUsage(
			{ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
			{
				prompt_tokens: 20,
				completion_tokens: 2,
				total_tokens: 22,
				estimated: true,
			},
		);
		expect(merged).toEqual({
			prompt_tokens: 30,
			completion_tokens: 3,
			total_tokens: 33,
			estimated: true,
		});
		expect("cached_tokens" in merged).toBe(false);
	});
});
