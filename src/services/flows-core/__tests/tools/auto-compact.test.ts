import { describe, expect, it } from "vitest";
import {
	applyAutoCompactPolicy,
	type AutoCompactConfig,
} from "flow-core/steps/features/auto-compact";
import type { ChatCompletionResponse } from "flow-core/interfaces/engine/messages";
import type { BaseLLM } from "flow-core/interfaces/services/llm";

const fakeLLM: BaseLLM = {
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 4096,
	getMaxResponseTokens: async () => 1024,
	chatCompletions: async (): Promise<ChatCompletionResponse> => ({
		id: "summary",
		object: "chat.completion",
		created: 1,
		model: "test-model",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "summary" },
				finish_reason: "stop",
			},
		],
	}),
};

const config: AutoCompactConfig = {
	compactThresholdRatio: 0.5,
	safeThresholdRatio: 0.5,
};

describe("applyAutoCompactPolicy tool-message trimming", () => {
	it("trims old tool results while preserving assistant tool calls", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Use a tool" }],
				outputMessages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "large_tool", arguments: "{}" },
							},
						],
					},
					{
						role: "tool",
						tool_call_id: "call_1",
						content: "x".repeat(260),
					},
				],
			},
			fakeLLM,
			config,
			200,
		);

		expect(result?.outputMessages).toEqual([
			expect.objectContaining({
				role: "assistant",
				tool_calls: [expect.objectContaining({ id: "call_1" })],
			}),
			expect.objectContaining({
				role: "tool",
				tool_call_id: "call_1",
				content: expect.stringContaining("Tool result trimmed"),
			}),
		]);
	});

	it("removes old assistant tool-call flows when tool-result trimming is insufficient", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Continue" }],
				outputMessages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: {
									name: "large_tool",
									arguments: JSON.stringify({ value: "x".repeat(400) }),
								},
							},
						],
					},
					{
						role: "tool",
						tool_call_id: "call_1",
						content: "x".repeat(400),
					},
				],
			},
			fakeLLM,
			{ compactThresholdRatio: 0.5, safeThresholdRatio: 0.1 },
			200,
		);

		expect(result?.messages).toEqual([{ role: "user", content: "Continue" }]);
		expect(result?.outputMessages).toEqual([]);
	});

	it("removes older normal chat messages while preserving the latest user message", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [],
			},
			fakeLLM,
			config,
			120,
		);

		expect(result?.messages).toEqual([
			{ role: "user", content: "latest question" },
		]);
		expect(result?.outputMessages).toEqual([]);
	});
});
