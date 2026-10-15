import { describe, expect, it } from "vitest";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "@/types/openai";
import {
	createHostedAppAi,
	type HostedChatModel,
	hostedAppUsageScope,
} from "../ai";
import type { HostedChatPart } from "../protocol";

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
	extra: Partial<ChatCompletionChunk> & {
		finish?: ChatCompletionChunk["choices"][number]["finish_reason"];
	} = {},
): ChatCompletionChunk => ({
	id: "c",
	object: "chat.completion.chunk",
	created: 0,
	model: "chosen-model",
	choices: [{ index: 0, delta, finish_reason: extra.finish ?? null }],
	...(extra.usage ? { usage: extra.usage } : {}),
});

/** The chosen model, answering with `chunks` and keeping each request. */
const model = (
	chunks: ChatCompletionChunk[],
	options: { ready?: boolean; fail?: Error } = {},
) => {
	const requests: ChatCompletionRequest[] = [];
	const port: HostedChatModel = {
		ready: async () => options.ready !== false,
		async *stream(request) {
			requests.push(request);
			for (const next of chunks) {
				if (request.signal?.aborted) throw new Error("aborted");
				yield next;
			}
			if (options.fail) throw options.fail;
		},
	};
	return { port, requests };
};

const TOOL = {
	type: "function",
	function: { name: "add_slide", parameters: { type: "object" } },
};

describe("the apps' AI, answered by the chosen model", () => {
	it("streams words, then each complete call and the token count, as Puter's parts", async () => {
		const { port, requests } = model([
			chunk({ reasoning: "thinking" }),
			chunk({ content: "Adding " }),
			chunk({ content: "a slide." }),
			chunk({
				tool_calls: [
					{
						index: 0,
						id: "call_1",
						function: { name: "add_slide", arguments: '{"ti' },
					},
				],
			}),
			chunk({
				tool_calls: [{ index: 0, function: { arguments: 'tle":"Intro"}' } }],
			}),
			chunk(
				{},
				{
					finish: "tool_calls",
					usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
				},
			),
		]);
		const parts: HostedChatPart[] = [];
		const reply = await createHostedAppAi(port).chat(
			{
				messages: [{ role: "user", content: "Add an intro slide" }],
				tools: [TOOL],
				stream: true,
				// Puter's model, not the user's: not used.
				model: "claude-opus-5-5",
				max_tokens: 300,
			},
			{ onPart: (part) => parts.push(part) },
		);

		expect(parts).toEqual([
			{ type: "reasoning", reasoning: "thinking" },
			{ type: "text", text: "Adding " },
			{ type: "text", text: "a slide." },
			{
				type: "tool_use",
				id: "call_1",
				name: "add_slide",
				input: { title: "Intro" },
			},
			{
				type: "usage",
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			},
		]);
		expect(reply.message).toEqual({
			role: "assistant",
			content: "Adding a slide.",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: { name: "add_slide", arguments: '{"title":"Intro"}' },
				},
			],
		});
		expect(reply.finish_reason).toBe("tool_calls");
		expect(requests[0]).toMatchObject({
			messages: [{ role: "user", content: "Add an intro slide" }],
			tools: [TOOL],
			max_tokens: 300,
			stream: true,
		});
		expect(requests[0]).not.toHaveProperty("model");
	});

	it("keeps a conversation's tool calls and answers, and the pictures in it", async () => {
		const { port, requests } = model([chunk({ content: "A cat." })]);
		await createHostedAppAi(port).chat({
			messages: [
				{ role: "system", content: "Be brief." },
				{
					role: "user",
					content: [
						{ type: "text", text: "What is this?" },
						{
							type: "image_url",
							image_url: { url: "data:image/png;base64,AA" },
						},
					],
				},
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "t1",
							type: "function",
							function: { name: "look", arguments: "{}" },
						},
					],
				},
				{ role: "tool", tool_call_id: "t1", content: "a cat" },
			],
		});
		expect(requests[0]?.messages).toEqual([
			{ role: "system", content: "Be brief." },
			{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
				],
			},
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "t1",
						type: "function",
						function: { name: "look", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "t1", content: "a cat" },
		]);
	});

	it("marks arguments it cannot read, as the apps expect", async () => {
		const { port } = model([
			chunk({
				tool_calls: [
					{ index: 0, id: "c", function: { name: "f", arguments: "{oops" } },
				],
			}),
		]);
		const parts: HostedChatPart[] = [];
		await createHostedAppAi(port).chat(
			{ messages: [{ role: "user", content: "go" }], stream: true },
			{ onPart: (part) => parts.push(part) },
		);
		expect(parts).toEqual([
			{
				type: "tool_use",
				id: "c",
				name: "f",
				input: { __unreadable: "{oops" },
			},
		]);
	});

	it("says to choose a model when none is chosen", async () => {
		const { port } = model([], { ready: false });
		await expect(
			createHostedAppAi(port).chat({
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toMatchObject({
			code: "no_model",
			message: /Choose a chat model/,
		});
	});

	it("refuses a request without messages", async () => {
		const { port } = model([]);
		await expect(
			createHostedAppAi(port).chat({ messages: [] }),
		).rejects.toMatchObject({ code: "invalid_request" });
		await expect(
			createHostedAppAi(port).chat({
				messages: [{ role: "robot", content: "x" }],
			}),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("passes on the provider's failure, and a stop as a stop", async () => {
		const failing = model([chunk({ content: "Hal" })], {
			fail: new Error("Rate limited"),
		});
		await expect(
			createHostedAppAi(failing.port).chat({
				messages: [{ role: "user", content: "hi" }],
			}),
		).rejects.toMatchObject({ code: "ai_failed", message: "Rate limited" });

		const stopped = new AbortController();
		stopped.abort();
		const { port } = model([chunk({ content: "never" })]);
		await expect(
			createHostedAppAi(port).chat(
				{ messages: [{ role: "user", content: "hi" }] },
				{ signal: stopped.signal },
			),
		).rejects.toMatchObject({ code: "cancelled" });
	});
});

describe("who the apps' AI is charged to", () => {
	it("books each file as a session of its app, to the computer's agent in MemonOS", () => {
		expect(
			hostedAppUsageScope({
				app: "presentation",
				path: "/notes/Pitch.pptx",
				agentId: "agent-1",
			}),
		).toEqual({
			source: "apps",
			tool: "presentation",
			agentId: "agent-1",
			conversationId: null,
			sessionId: "presentation:/notes/Pitch.pptx",
			title: "Presentation · Pitch.pptx",
		});
		expect(hostedAppUsageScope({ app: "pdf", path: null })).toMatchObject({
			agentId: null,
			title: "PDF",
		});
	});
});
