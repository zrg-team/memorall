import { describe, expect, it } from "vitest";
import type { MessageParts } from "@/types/chat";
import { MessagePartsAccumulator, resolveMessageParts } from "../message-parts";

const streamed: MessageParts = [
	{
		role: "assistant",
		content: "Let me look.",
		tool_calls: [
			{
				id: "call-1",
				type: "function",
				function: { name: "fs_read", arguments: "{}" },
			},
		],
	},
	{ role: "tool", tool_call_id: "call-1", content: "file" },
	{ role: "assistant", content: "Here it is." },
];

describe("resolveMessageParts", () => {
	it("keeps the streamed turn when the graph only reports its final message", () => {
		expect(
			resolveMessageParts({
				finalState: {
					outputMessages: [{ role: "assistant", content: "Here it is." }],
				},
				accumulatedParts: streamed,
			}),
		).toEqual(streamed);
	});

	it("prefers the graph's messages when they cover everything streamed", () => {
		const outputMessages = [
			{ ...streamed[0], content: "Let me look (canonical)." },
			streamed[1],
			streamed[2],
		];
		expect(
			resolveMessageParts({
				finalState: { outputMessages },
				accumulatedParts: streamed,
			}),
		).toEqual(outputMessages);
	});

	it("falls back to the streamed parts when the graph reports nothing", () => {
		expect(
			resolveMessageParts({ finalState: {}, accumulatedParts: streamed }),
		).toEqual(streamed);
	});
});

describe("reasoning in message parts", () => {
	const chunk = (delta: Record<string, unknown>) => ({
		id: "chunk",
		object: "chat.completion.chunk" as const,
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: null }],
	});

	it("keeps a turn's thinking on the assistant part it led to", () => {
		const accumulator = new MessagePartsAccumulator();
		accumulator.addChunk(chunk({ role: "assistant", reasoning: "Think" }));
		accumulator.addChunk(chunk({ reasoning: " hard." }));
		accumulator.addChunk(chunk({ content: "Answer." }));
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "c", content: "r" }),
		);
		accumulator.addChunk(chunk({ reasoning: "Again." }));

		expect(accumulator.toParts()).toEqual([
			{ role: "assistant", content: "Answer.", reasoning: "Think hard." },
			{ role: "tool", tool_call_id: "c", content: "r" },
			{ role: "assistant", content: "", reasoning: "Again." },
		]);
	});

	it("keeps the streamed thinking when the graph's own messages are used", () => {
		// The graph's messages never saw the reasoning: it only reached the stream.
		const outputMessages: MessageParts = [
			{ role: "assistant", content: "Answer (cited)." },
		];
		expect(
			resolveMessageParts({
				finalState: { outputMessages },
				accumulatedParts: [
					{ role: "assistant", content: "Answer.", reasoning: "Think." },
				],
			}),
		).toEqual([
			{ role: "assistant", content: "Answer (cited).", reasoning: "Think." },
		]);
	});
});
