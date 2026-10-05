import { describe, expect, it, vi } from "vitest";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { ChatCompletionChunk } from "@/types/openai";
import { meterLlmService } from "../metered-llm";
import type { ModelUsageEntry } from "../model-usage-ledger";

const chunk = (
	content: string,
	extra: Partial<ChatCompletionChunk> = {},
): ChatCompletionChunk => ({
	id: "c",
	object: "chat.completion.chunk",
	created: 0,
	model: "coder",
	choices: [{ index: 0, delta: { content }, finish_reason: null }],
	...extra,
});

const scope = {
	source: "pi-code",
	tool: "memon_code",
	agentId: "agent-1",
	sessionId: "session-1",
	title: "pi code · ~/todo",
};

const setup = (llm: Partial<ILLMService>) => {
	const booked: ModelUsageEntry[] = [];
	const record = vi.fn(async (entry: ModelUsageEntry) => {
		booked.push(entry);
	});
	const base = {
		getInfo: () => ({ name: "default", type: "openrouter", ready: true }),
		getInfoFor: (name: string) => ({
			name,
			type: name === "local" ? "ollama" : "openrouter",
			ready: true,
		}),
		getCurrentModel: async () => ({
			modelId: "coder",
			provider: "openrouter",
			serviceName: "openrouter",
		}),
		...llm,
	} as unknown as ILLMService;
	return { metered: meterLlmService(base, () => scope, record), booked };
};

const drain = async <T>(items: AsyncIterable<T>) => {
	const seen: T[] = [];
	for await (const item of items) seen.push(item);
	return seen;
};

describe("meterLlmService", () => {
	it("books a streamed request with the usage the provider reported", async () => {
		const { metered, booked } = setup({
			chatCompletionsFor: () =>
				(async function* () {
					yield chunk("Hel");
					yield chunk("lo", {
						usage: {
							prompt_tokens: 120,
							completion_tokens: 8,
							total_tokens: 128,
							prompt_tokens_details: { cached_tokens: 100 },
							cost: 0.002,
						} as ChatCompletionChunk["usage"],
					});
				})(),
		});
		const chunks = await drain(
			metered.chatCompletionsFor("openrouter", {
				model: "coder",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			}) as AsyncIterable<ChatCompletionChunk>,
		);
		expect(chunks.map((part) => part.choices[0].delta.content)).toEqual([
			"Hel",
			"lo",
		]);
		expect(booked).toEqual([
			{
				...scope,
				provider: "openrouter",
				model: "coder",
				usage: {
					prompt_tokens: 120,
					completion_tokens: 8,
					total_tokens: 128,
					cached_tokens: 100,
					cost: 0.002,
				},
			},
		]);
	});

	it("estimates what a provider without usage reporting read and wrote", async () => {
		const { metered, booked } = setup({
			chatCompletionsFor: async () => ({
				id: "r",
				object: "chat.completion",
				created: 0,
				model: "llama-4",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "x".repeat(40) },
						finish_reason: "stop",
					},
				],
			}),
		});
		await metered.chatCompletionsFor("local", {
			model: "llama-4",
			messages: [{ role: "user", content: "y".repeat(400) }],
		});
		expect(booked).toHaveLength(1);
		expect(booked[0]).toMatchObject({
			provider: "ollama",
			model: "llama-4",
			usage: { completion_tokens: 10, estimated: true },
		});
		expect(booked[0].usage.prompt_tokens).toBeGreaterThan(100);
	});

	it("books a request cut off mid-stream, but not one that failed before any output", async () => {
		const { metered, booked } = setup({
			chatCompletionsFor: (_name, request) =>
				(async function* () {
					if (request.messages.length > 1) throw new Error("bad request");
					yield chunk("partial");
					throw new Error("connection lost");
				})(),
		});
		await expect(
			drain(
				metered.chatCompletionsFor("openrouter", {
					model: "coder",
					messages: [{ role: "user", content: "hi" }],
					stream: true,
				}) as AsyncIterable<ChatCompletionChunk>,
			),
		).rejects.toThrow("connection lost");
		await expect(
			drain(
				metered.chatCompletionsFor("openrouter", {
					model: "coder",
					messages: [
						{ role: "user", content: "a" },
						{ role: "user", content: "b" },
					],
					stream: true,
				}) as AsyncIterable<ChatCompletionChunk>,
			),
		).rejects.toThrow("bad request");
		expect(booked).toHaveLength(1);
		expect(booked[0].usage).toMatchObject({ estimated: true });
	});

	it("books decisions and generated images by their token usage, and passes the rest through", async () => {
		const { metered, booked } = setup({
			systemOneFor: async () => ({
				object: "systemone",
				model: "judge",
				answers: {},
				usage: { input_tokens: 50, output_tokens: 5, cost: 0.0001 },
			}),
			imagesGenerationsFor: () =>
				(async function* () {
					yield { type: "image_generation.progress" as const, percent: 50 };
					yield {
						type: "image_generation.completed" as const,
						result: {
							created: 0,
							data: [],
							usage: { input_tokens: 30, output_tokens: 4_000 },
						},
					};
				})(),
		});
		await metered.systemOneFor("openrouter", {
			model: "judge",
			state: "s",
			questions: {},
		} as never);
		await drain(
			metered.imagesGenerationsFor("openrouter", {
				model: "painter",
				prompt: "a cat",
			}),
		);
		expect(booked.map((entry) => [entry.model, entry.usage])).toEqual([
			[
				"judge",
				{
					prompt_tokens: 50,
					completion_tokens: 5,
					total_tokens: 55,
					cost: 0.0001,
				},
			],
			[
				"painter",
				{ prompt_tokens: 30, completion_tokens: 4_000, total_tokens: 4_030 },
			],
		]);
		expect(await metered.getCurrentModel()).toMatchObject({ modelId: "coder" });
	});
});
