import { describe, expect, it } from "vitest";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "@/types/openai";
import {
	createFxGatewayFetch,
	FX_CHAT_MODEL,
	FX_GATEWAY_ORIGIN,
	type FxGatewayModels,
} from "../fx-gateway";

const CURRENT = {
	modelId: "openai/gpt-4o",
	provider: "openrouter",
	serviceName: "openrouter-main",
};

const chunk = (
	content: string,
	extra: Partial<ChatCompletionChunk> = {},
): ChatCompletionChunk => ({
	id: "c1",
	object: "chat.completion.chunk",
	created: 0,
	model: CURRENT.modelId,
	choices: [{ index: 0, delta: { content }, finish_reason: null }],
	...extra,
});

/** A metered LLM service that answers every request with "Hi there." */
const fakeModels = (
	options: { current?: typeof CURRENT | null; listed?: string[] } = {},
) => {
	const requests: Array<{
		serviceName: string;
		request: ChatCompletionRequest;
	}> = [];
	const models = {
		getCurrentModel: async () =>
			options.current === undefined ? CURRENT : options.current,
		modelsFor: async () => ({
			object: "list" as const,
			data: (options.listed ?? [CURRENT.modelId]).map((id) => ({
				id,
				name: `${id} name`,
			})),
		}),
		getMaxModelTokensFor: async () => 128_000,
		getMaxResponseTokensFor: async () => 16_384,
		chatCompletionsFor(serviceName: string, request: ChatCompletionRequest) {
			requests.push({ serviceName, request });
			return (async function* () {
				yield chunk("Hi ");
				yield chunk("there.", {
					choices: [
						{ index: 0, delta: { content: "there." }, finish_reason: "stop" },
					],
					usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
				});
			})();
		},
	} as unknown as FxGatewayModels;
	return { models, requests };
};

const modelCall = (headers: Record<string, string> = {}) => ({
	method: "POST",
	headers: {
		"ai-language-model-id": "memorall/openai/gpt-4o",
		"ai-language-model-streaming": "true",
		"x-session-id": "fx-session-1",
		...headers,
	},
	body: new TextEncoder().encode(
		JSON.stringify({
			prompt: [
				{ role: "system", content: "You are fx." },
				{ role: "user", content: [{ type: "text", text: "hi" }] },
			],
			tools: [
				{ type: "function", name: "shell", inputSchema: { type: "object" } },
			],
			toolChoice: { type: "auto" },
		}),
	),
});

const streamParts = async (response: Response) =>
	(await response.text())
		.split("\n\n")
		.filter(Boolean)
		.map((event) => JSON.parse(event.replace(/^data: /, "")));

describe("fx gateway", () => {
	it("answers fx's model call with the chat model, as AI SDK stream parts", async () => {
		const { models, requests } = fakeModels();
		const sessions: string[] = [];
		const gateway = createFxGatewayFetch({
			models: async () => models,
			onSession: (id) => sessions.push(id),
		});

		const response = await gateway(
			`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
			modelCall(),
		);

		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const parts = await streamParts(response);
		expect(parts.map((part) => part.type)).toEqual([
			"stream-start",
			"response-metadata",
			"text-start",
			"text-delta",
			"text-delta",
			"text-end",
			"finish",
		]);
		expect(parts.at(-1)).toMatchObject({
			finishReason: { unified: "stop", raw: "stop" },
			usage: { inputTokens: { total: 12 }, outputTokens: { total: 3 } },
		});
		expect(requests[0]?.serviceName).toBe("openrouter-main");
		expect(requests[0]?.request).toMatchObject({
			model: "openai/gpt-4o",
			stream: true,
			prompt_cache_key: "fx:fx-session-1",
			messages: [
				{ role: "system", content: "You are fx." },
				{ role: "user", content: "hi" },
			],
			tools: [{ type: "function", function: { name: "shell" } }],
		});
		expect(sessions).toEqual(["fx-session-1"]);
	});

	it("uses the model fx's /model picked when the provider has it, else the chat model", async () => {
		const { models, requests } = fakeModels({
			listed: ["openai/gpt-4o", "anthropic/claude"],
		});
		const gateway = createFxGatewayFetch({ models: async () => models });

		await (
			await gateway(
				`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
				modelCall({ "ai-language-model-id": "memorall/anthropic/claude" }),
			)
		).text();
		await (
			await gateway(
				`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
				modelCall({ "ai-language-model-id": "memorall/gone" }),
			)
		).text();
		await (
			await gateway(
				`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
				modelCall({ "ai-language-model-id": FX_CHAT_MODEL }),
			)
		).text();

		expect(requests.map((entry) => entry.request.model)).toEqual([
			"anthropic/claude",
			"openai/gpt-4o",
			"openai/gpt-4o",
		]);
	});

	it("says to choose a model when the chat has none", async () => {
		const { models } = fakeModels({ current: null });
		const gateway = createFxGatewayFetch({ models: async () => models });

		const response = await gateway(
			`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
			modelCall(),
		);

		expect(response.status).toBe(409);
		expect(await response.text()).toContain(
			"No chat model is selected in Memorall",
		);
	});

	it("lists the chat model, then the provider's models, for /model", async () => {
		const { models } = fakeModels({
			listed: ["openai/gpt-4o", "anthropic/claude"],
		});
		const gateway = createFxGatewayFetch({ models: async () => models });

		const response = await gateway(
			`${FX_GATEWAY_ORIGIN}/coding-agent/v1/models`,
			{ method: "GET" },
		);
		const { data } = await response.json();

		expect(data.map((model: { id: string }) => model.id)).toEqual([
			"memorall/chat",
			"memorall/openai/gpt-4o",
			"memorall/anthropic/claude",
		]);
		expect(data[0].name).toBe("Chat model (openai/gpt-4o)");
		expect(data[1]).toMatchObject({
			context_window: 128_000,
			max_tokens: 16_384,
			type: "language",
		});
		expect(data[2].context_window).toBeUndefined();
	});

	it("returns a whole reply when fx does not stream", async () => {
		const { models } = fakeModels();
		const gateway = createFxGatewayFetch({ models: async () => models });

		const response = await gateway(
			`${FX_GATEWAY_ORIGIN}/v4/ai/language-model`,
			modelCall({ "ai-language-model-streaming": "false" }),
		);

		expect(await response.json()).toMatchObject({
			content: [{ type: "text", text: "Hi there." }],
			finishReason: { unified: "stop" },
		});
	});

	it("reaches nothing but Memorall's models", async () => {
		const { models, requests } = fakeModels();
		const gateway = createFxGatewayFetch({ models: async () => models });

		const elsewhere = await gateway("https://api.vercel.com/v2/teams", {
			method: "GET",
		});
		const unknown = await gateway(`${FX_GATEWAY_ORIGIN}/v1/credits`, {
			method: "GET",
		});

		expect(elsewhere.status).toBe(403);
		expect(unknown.status).toBe(404);
		expect(requests).toEqual([]);
	});
});
