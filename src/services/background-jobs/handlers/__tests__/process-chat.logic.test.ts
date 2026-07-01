import { describe, expect, it, vi } from "vitest";
import { MessagePartsAccumulator } from "@/services/chat/message-parts";
import { StreamBuffer } from "../stream-buffer";
import type { ChatCompletionChunk } from "@/types/openai";

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
): ChatCompletionChunk => ({
	id: "chunk",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [{ index: 0, delta, finish_reason: null }],
});

describe("StreamBuffer", () => {
	it("buffers until the word threshold and flushes remaining content", () => {
		const onEmit = vi.fn();
		const buffer = new StreamBuffer(3, onEmit);

		buffer.add("hello ");
		expect(onEmit).not.toHaveBeenCalled();
		expect(buffer.peek()).toBe("hello ");

		buffer.add("world again");
		expect(onEmit).toHaveBeenCalledWith("hello world again");
		expect(buffer.peek()).toBe("");

		buffer.add("tail");
		buffer.flush();
		expect(onEmit).toHaveBeenLastCalledWith("tail");
	});
});

describe("MessagePartsAccumulator", () => {
	it("accumulates assistant content, tool calls, and tool results in order", () => {
		const accumulator = new MessagePartsAccumulator();

		accumulator.addChunk(chunk({ role: "assistant", content: "Hello " }));
		accumulator.addChunk(chunk({ content: "world" }));
		accumulator.addChunk(
			chunk({
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: '{"q"' },
					},
				],
			}),
		);
		accumulator.addChunk(
			chunk({
				tool_calls: [
					{
						index: 0,
						type: "function",
						function: { arguments: ':"x"}' },
					},
				],
			}),
		);
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "call-1", content: "result" }),
		);

		expect(accumulator.toParts()).toEqual([
			{
				role: "assistant",
				content: "Hello world",
				tool_calls: [
					{
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: '{"q":"x"}' },
					},
				],
			},
			{ role: "tool", content: "result", tool_call_id: "call-1" },
		]);
	});
});
