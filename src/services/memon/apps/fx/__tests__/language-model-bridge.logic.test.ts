import { describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "@/types/openai";
import {
	type LanguageModelCall,
	type LanguageModelStreamPart,
	toChatCompletionRequest,
	toEventStream,
	toLanguageModelStream,
} from "../language-model-bridge";

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
	extra: Partial<ChatCompletionChunk> & {
		finish_reason?: ChatCompletionChunk["choices"][number]["finish_reason"];
	} = {},
): ChatCompletionChunk => {
	const { finish_reason = null, ...rest } = extra;
	return {
		id: "chunk-1",
		object: "chat.completion.chunk",
		created: 0,
		model: "provider/model",
		choices: [{ index: 0, delta, finish_reason }],
		...rest,
	};
};

async function* from<T>(items: T[]): AsyncGenerator<T> {
	for (const item of items) yield item;
}

const collect = async (
	chunks: ChatCompletionChunk[],
): Promise<LanguageModelStreamPart[]> => {
	const parts: LanguageModelStreamPart[] = [];
	for await (const part of toLanguageModelStream(
		from(chunks),
		"memorall/default",
	)) {
		parts.push(part);
	}
	return parts;
};

describe("toChatCompletionRequest", () => {
	// The shape fx 0.0.14 sends, trimmed: several system messages, a prompt,
	// the previous tool round and its one workspace tool.
	const call: LanguageModelCall = {
		prompt: [
			{ role: "system", content: "You are fx." },
			{ role: "system", content: "Runtime: /workspace" },
			{ role: "user", content: [{ type: "text", text: "list files" }] },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "I should look." },
					{ type: "text", text: "Looking." },
					{
						type: "tool-call",
						toolCallId: "call1",
						toolName: "shell",
						input: { action: "run", command: "ls -la" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call1",
						toolName: "shell",
						output: {
							type: "text",
							value: "exit_code=0\n<stdout>\na.txt\n</stdout>\n",
						},
					},
				],
			},
		],
		tools: [
			{
				type: "function",
				name: "shell",
				description: "Run a command.",
				inputSchema: {
					type: "object",
					properties: { command: { type: "string" } },
				},
			},
		],
		toolChoice: { type: "auto" },
		providerOptions: { gateway: { caching: "auto" } },
	};

	it("joins fx's system messages and keeps the tool round", () => {
		const request = toChatCompletionRequest(call);

		expect(request.messages).toEqual([
			{ role: "system", content: "You are fx.\n\nRuntime: /workspace" },
			{ role: "user", content: "list files" },
			{
				role: "assistant",
				content: "Looking.",
				tool_calls: [
					{
						id: "call1",
						type: "function",
						function: {
							name: "shell",
							arguments: '{"action":"run","command":"ls -la"}',
						},
					},
				],
			},
			{
				role: "tool",
				tool_call_id: "call1",
				content: "exit_code=0\n<stdout>\na.txt\n</stdout>\n",
			},
		]);
		expect(request.tools).toEqual([
			{
				type: "function",
				function: {
					name: "shell",
					description: "Run a command.",
					parameters: {
						type: "object",
						properties: { command: { type: "string" } },
					},
				},
			},
		]);
		expect(request.tool_choice).toBe("auto");
		expect(request.stream).toBe(true);
	});

	it("sends images as image parts and names files the model cannot read", () => {
		const request = toChatCompletionRequest({
			prompt: [
				{
					role: "user",
					content: [
						{ type: "text", text: "What is this?" },
						{ type: "file", data: "iVBORw0K", mediaType: "image/png" },
						{
							type: "file",
							data: "JVBERi0x",
							mediaType: "application/pdf",
							filename: "a.pdf",
						},
					],
				},
			],
		});

		expect(request.messages[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "What is this?" },
				{
					type: "image_url",
					image_url: {
						url: "data:image/png;base64,iVBORw0K",
						mimeType: "image/png",
					},
				},
				{ type: "text", text: "[a.pdf attached, not readable by this model]" },
			],
		});
	});

	it("turns every tool result output into text", () => {
		const request = toChatCompletionRequest({
			prompt: [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "a",
							toolName: "t",
							output: { type: "json", value: { ok: true } },
						},
						{
							type: "tool-result",
							toolCallId: "b",
							toolName: "t",
							output: { type: "execution-denied", reason: "not now" },
						},
						{
							type: "tool-result",
							toolCallId: "c",
							toolName: "t",
							output: {
								type: "content",
								value: [
									{ type: "text", text: "seen" },
									{ type: "image-data", data: "x", mediaType: "image/png" },
								],
							},
						},
					],
				},
			],
		});

		expect(request.messages.map((message) => message.content)).toEqual([
			'{"ok":true}',
			"The user denied this action: not now",
			"seen\n[image-data image/png omitted]",
		]);
	});

	it("names a forced tool and carries fx's reasoning effort", () => {
		const request = toChatCompletionRequest({
			...call,
			toolChoice: { type: "tool", toolName: "shell" },
			providerOptions: { openai: { reasoningEffort: "high" } },
			maxOutputTokens: 512,
		});

		expect(request.tool_choice).toEqual({
			type: "function",
			function: { name: "shell" },
		});
		expect(request.reasoning_effort).toBe("high");
		expect(request.max_tokens).toBe(512);
	});
});

describe("toLanguageModelStream", () => {
	it("streams reasoning, then text, and finishes with fx's usage shape", async () => {
		const parts = await collect([
			chunk({ reasoning: "Thinking." }),
			chunk({ content: "Hello " }),
			chunk({ content: "there." }, { finish_reason: "stop" }),
			{
				...chunk({}),
				choices: [],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					total_tokens: 120,
					cached_tokens: 40,
					reasoning_tokens: 5,
				},
			},
		]);

		expect(parts).toEqual([
			{ type: "stream-start", warnings: [] },
			{ type: "response-metadata", id: "chunk-1", modelId: "provider/model" },
			{ type: "reasoning-start", id: "reasoning-0" },
			{ type: "reasoning-delta", id: "reasoning-0", delta: "Thinking." },
			{ type: "reasoning-end", id: "reasoning-0" },
			{ type: "text-start", id: "text-0" },
			{ type: "text-delta", id: "text-0", delta: "Hello " },
			{ type: "text-delta", id: "text-0", delta: "there." },
			{ type: "text-end", id: "text-0" },
			{
				type: "finish",
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: {
						total: 100,
						noCache: 60,
						cacheRead: 40,
						cacheWrite: 0,
					},
					outputTokens: { total: 20, text: 15, reasoning: 5 },
				},
			},
		]);
	});

	it("streams a tool call's input and announces the call whole at the end", async () => {
		const parts = await collect([
			chunk({
				tool_calls: [
					{
						index: 0,
						id: "call_a",
						type: "function",
						function: { name: "shell", arguments: "" },
					},
				],
			}),
			chunk({
				tool_calls: [{ index: 0, function: { arguments: '{"action":"run",' } }],
			}),
			chunk(
				{
					tool_calls: [
						{ index: 0, function: { arguments: '"command":"ls"}' } },
					],
				},
				{ finish_reason: "tool_calls" },
			),
		]);

		expect(parts.slice(2)).toEqual([
			{ type: "tool-input-start", id: "call_a", toolName: "shell" },
			{ type: "tool-input-delta", id: "call_a", delta: '{"action":"run",' },
			{ type: "tool-input-delta", id: "call_a", delta: '"command":"ls"}' },
			{ type: "tool-input-end", id: "call_a" },
			{
				type: "tool-call",
				toolCallId: "call_a",
				toolName: "shell",
				input: '{"action":"run","command":"ls"}',
			},
			{
				type: "finish",
				finishReason: { unified: "tool-calls", raw: "tool_calls" },
				usage: expect.any(Object),
			},
		]);
	});

	it("runs tool calls a provider reported with a plain stop", async () => {
		const parts = await collect([
			chunk(
				{
					tool_calls: [
						{
							index: 0,
							function: { name: "shell", arguments: '{"command":"pwd"}' },
						},
					],
				},
				{ finish_reason: "stop" },
			),
		]);

		const call = parts.find((part) => part.type === "tool-call");
		expect(call).toEqual({
			type: "tool-call",
			toolCallId: "call_0",
			toolName: "shell",
			input: '{"command":"pwd"}',
		});
		expect(parts.at(-1)).toMatchObject({
			finishReason: { unified: "tool-calls", raw: "stop" },
		});
	});

	it("keeps argument text that arrived before the tool's name", async () => {
		const parts = await collect([
			chunk({
				tool_calls: [{ index: 0, id: "c", function: { arguments: '{"a":' } }],
			}),
			chunk({
				tool_calls: [
					{ index: 0, function: { name: "shell", arguments: "1}" } },
				],
			}),
		]);

		expect(parts.filter((part) => part.type.startsWith("tool-"))).toEqual([
			{ type: "tool-input-start", id: "c", toolName: "shell" },
			{ type: "tool-input-delta", id: "c", delta: '{"a":' },
			{ type: "tool-input-delta", id: "c", delta: "1}" },
			{ type: "tool-input-end", id: "c" },
			{
				type: "tool-call",
				toolCallId: "c",
				toolName: "shell",
				input: '{"a":1}',
			},
		]);
	});
});

describe("toEventStream", () => {
	const read = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
		new Response(stream).text();

	it("writes each part as one server-sent event", async () => {
		const text = await read(
			toEventStream(
				from<LanguageModelStreamPart>([
					{ type: "stream-start", warnings: [] },
					{ type: "text-start", id: "t" },
				]),
			),
		);

		expect(text).toBe(
			'data: {"type":"stream-start","warnings":[]}\n\ndata: {"type":"text-start","id":"t"}\n\n',
		);
	});

	it("ends a reply that failed midway with an error part", async () => {
		async function* failing(): AsyncGenerator<LanguageModelStreamPart> {
			yield { type: "stream-start", warnings: [] };
			throw new Error("Choose a chat model first.");
		}

		const text = await read(toEventStream(failing()));

		expect(text).toContain(
			'data: {"type":"error","error":"Choose a chat model first."}',
		);
	});
});
