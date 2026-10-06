import { describe, expect, it } from "vitest";
import type { ChatCompletionMessageParam } from "@/types/openai";
import { liftToolImages } from "../tool-images";

const PICTURE = "data:image/png;base64,AAAA";

const toolWithPicture = (id: string, text: string) =>
	({
		role: "tool",
		tool_call_id: id,
		content: [
			{ type: "text", text },
			{ type: "image_url", image_url: { url: PICTURE, detail: "auto" } },
		],
	}) as unknown as ChatCompletionMessageParam;

describe("a tool's pictures", () => {
	it("go to the model in a user message right after the tool results", () => {
		const messages: ChatCompletionMessageParam[] = [
			{ role: "user", content: "What is on the page?" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "a",
						type: "function",
						function: { name: "memon_act", arguments: "{}" },
					},
					{
						id: "b",
						type: "function",
						function: { name: "memon_screen", arguments: "{}" },
					},
				],
			} as ChatCompletionMessageParam,
			toolWithPicture("a", "The picture of b9 (800×600) is attached."),
			{ role: "tool", tool_call_id: "b", content: "screen" },
		];

		expect(liftToolImages(messages)).toEqual([
			messages[0],
			messages[1],
			{
				role: "tool",
				tool_call_id: "a",
				content:
					"The picture of b9 (800×600) is attached.\n[the picture is in the next message]",
			},
			messages[3],
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "The pictures from the tool results above:",
					},
					{ type: "image_url", image_url: { url: PICTURE, detail: "auto" } },
				],
			},
		]);
	});

	it("leave a turn with none as it is, and come before the next reply", () => {
		const plain: ChatCompletionMessageParam[] = [
			{ role: "user", content: "hi" },
			{ role: "tool", tool_call_id: "x", content: "text only" },
		];
		expect(liftToolImages(plain)).toEqual(plain);

		const answered = liftToolImages([
			toolWithPicture("a", ""),
			{ role: "assistant", content: "It is a chart." },
		]);
		expect(answered.map((message) => message.role)).toEqual([
			"tool",
			"user",
			"assistant",
		]);
		expect(answered[0]?.content).toBe(
			"(a picture)\n[the picture is in the next message]",
		);
	});
});
