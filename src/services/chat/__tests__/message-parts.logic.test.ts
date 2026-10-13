import { describe, expect, it } from "vitest";
import type { MessageParts } from "@/types/chat";
import {
	hasReplyParts,
	MessagePartsAccumulator,
	resolveMessageParts,
	withReplyText,
} from "../message-parts";

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

describe("reminders in message parts", () => {
	const reminder = "<system-reminder>\nTasks: #10 (1/4)\n</system-reminder>";

	it("keeps a reminder byte for byte ahead of what the agent wrote after it", () => {
		const accumulator = new MessagePartsAccumulator();
		accumulator.addSystemReminder(reminder);
		accumulator.addChunk({
			id: "c",
			object: "chat.completion.chunk",
			created: 1,
			model: "m",
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "On it." },
					finish_reason: null,
				},
			],
		});

		expect(accumulator.toParts()).toEqual([
			{ role: "user", content: reminder },
			{ role: "assistant", content: "On it." },
		]);
	});

	it("does not take reminders alone for an answer", () => {
		expect(hasReplyParts([{ role: "user", content: reminder }])).toBe(false);
		expect(hasReplyParts([])).toBe(false);
		expect(hasReplyParts(null)).toBe(false);
		expect(hasReplyParts(streamed)).toBe(true);
	});

	it("adds text that never streamed after the reminders, so the parts hold it", () => {
		const parts: MessageParts = [{ role: "user", content: reminder }];
		expect(withReplyText(parts, "Two left.")).toEqual([
			{ role: "user", content: reminder },
			{ role: "assistant", content: "Two left." },
		]);
		// Nothing to add, or the answer is already there.
		expect(withReplyText(parts, "  ")).toBe(parts);
		expect(withReplyText(streamed, "Here it is.")).toBe(streamed);
		expect(withReplyText([], "text")).toEqual([]);
	});
});

describe("streamed parts snapshots", () => {
	const chunk = (delta: Record<string, unknown>) => ({
		id: "chunk",
		object: "chat.completion.chunk" as const,
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: null }],
	});

	it("hands back the parts a chunk did not touch as the same objects", () => {
		const accumulator = new MessagePartsAccumulator();
		accumulator.addChunk(
			chunk({
				role: "assistant",
				content: "Let me look.",
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						function: { name: "fs_read", arguments: "{}" },
					},
				],
			}),
		);
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "call-1", content: "file" }),
		);
		accumulator.addChunk(chunk({ content: "It says" }));
		const before = accumulator.toParts();

		accumulator.addChunk(chunk({ content: " hello." }));
		const after = accumulator.toParts();

		expect(after).not.toBe(before);
		// Only the part being written is a new copy.
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe(before[1]);
		expect(after[2]).not.toBe(before[2]);
		expect(after[2]).toEqual({ role: "assistant", content: "It says hello." });
		// What was handed out earlier is a copy: later chunks do not change it.
		expect(before[2]).toEqual({ role: "assistant", content: "It says" });
	});

	it("copies a tool result again only while it grows", () => {
		const accumulator = new MessagePartsAccumulator();
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "call-1", content: "par" }),
		);
		const before = accumulator.toParts();
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "call-1", content: "tial" }),
		);
		const after = accumulator.toParts();

		expect(after[0]).not.toBe(before[0]);
		expect(before[0]).toEqual({
			role: "tool",
			tool_call_id: "call-1",
			content: "par",
		});
		expect(accumulator.toParts()[0]).toBe(after[0]);
	});
});
