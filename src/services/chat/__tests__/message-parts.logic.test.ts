import { describe, expect, it } from "vitest";
import type { MessageParts } from "@/types/chat";
import { resolveMessageParts } from "../message-parts";

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
