import { describe, expect, it } from "vitest";

import {
	chunkHasFinishReason,
	estimatePromptTokens,
	extractChunkOutputText,
	extractResponseOutputText,
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
		});
	});
});
