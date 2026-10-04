import { describe, expect, it } from "vitest";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { Context, Model } from "../ai";
import { getSupportedThinkingLevels } from "../ai";
import {
	highlightCode,
	initTheme,
} from "../coding-agent/modes/interactive/theme/theme";
import {
	CHAT_MODEL_API,
	resolveChatModel,
	thinkingLevelForEffort,
	toChatMessages,
} from "../host/chat-model";

const model: Model<string> = {
	id: "m",
	name: "m",
	api: CHAT_MODEL_API,
	provider: "openai",
	baseUrl: "",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

describe("pi chat model bridge", () => {
	it("converts pi's messages to the chat completion dialect", () => {
		const context: Context = {
			systemPrompt: "be brief",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "look" }],
					timestamp: 1,
				},
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "hmm" },
						{ type: "text", text: "Reading." },
						{
							type: "toolCall",
							id: "c1",
							name: "read",
							arguments: { path: "a.png" },
						},
					],
					api: CHAT_MODEL_API,
					provider: "openai",
					model: "m",
					usage,
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "c1",
					toolName: "read",
					content: [
						{ type: "text", text: "Read image file [image/png]" },
						{ type: "image", data: "AAAA", mimeType: "image/png" },
					],
					isError: false,
					timestamp: 3,
				},
				// An aborted response with nothing in it is left out.
				{
					role: "assistant",
					content: [],
					api: CHAT_MODEL_API,
					provider: "openai",
					model: "m",
					usage,
					stopReason: "aborted",
					timestamp: 4,
				},
			],
		};

		expect(toChatMessages(model, context)).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "user", content: [{ type: "text", text: "look" }] },
			{
				role: "assistant",
				content: "Reading.",
				tool_calls: [
					{
						id: "c1",
						type: "function",
						function: { name: "read", arguments: '{"path":"a.png"}' },
					},
				],
			},
			{
				role: "tool",
				content: "Read image file [image/png]",
				tool_call_id: "c1",
			},
			{
				role: "user",
				content: [
					{ type: "text", text: "Attached image(s) from tool result:" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,AAAA" },
					},
				],
			},
		]);
	});

	it("maps the chat's reasoning efforts to pi's thinking levels", async () => {
		const llm = {
			getCurrentModel: async () => ({
				modelId: "r1",
				provider: "openrouter",
				serviceName: "openrouter",
			}),
			modelsFor: async () => ({
				object: "list",
				data: [
					{
						id: "r1",
						name: "Reasoner",
						reasoning: { efforts: ["low", "medium", "high"], mandatory: true },
					},
				],
			}),
			getMaxModelTokensFor: async () => 0,
			getMaxResponseTokensFor: async () => 0,
		} as unknown as ILLMService;

		const resolved = await resolveChatModel(async () => llm);
		expect(resolved).toMatchObject({
			id: "r1",
			provider: "openrouter",
			reasoning: true,
			contextWindow: 128_000,
		});
		// Mandatory reasoning: pi cannot turn it off.
		expect(resolved && getSupportedThinkingLevels(resolved)).toEqual([
			"low",
			"medium",
			"high",
		]);
		expect(thinkingLevelForEffort("none")).toBe("off");
		expect(thinkingLevelForEffort("max")).toBe("xhigh");
		expect(thinkingLevelForEffort(undefined)).toBeUndefined();
	});

	it("highlights code with Prism the way pi's theme expects", () => {
		initTheme("dark");
		const [line] = highlightCode("const answer = 42;", "typescript");
		expect(line).toContain("\x1b[38;2;");
		expect(line.replace(/\x1b\[[0-9;]*m/g, "")).toBe("const answer = 42;");
	});
});
