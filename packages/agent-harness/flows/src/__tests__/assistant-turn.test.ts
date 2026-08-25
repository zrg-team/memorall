import { describe, expect, it, vi } from "vitest";
import { streamAssistantTurn } from "../graph/agent/assistant-turn.js";
import { createFlowRunLifecycle } from "../context/run-lifecycle.js";
import { compactToBudget } from "../steps/features/auto-compact.js";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "../interfaces/engine/messages.js";

const OPENROUTER_402 = new Error(
	'OpenAI streaming completion failed: 402  {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 52960. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402}}',
);

const CONTEXT_400 = new Error(
	"400 {\"error\":{\"message\":\"This model's maximum context length is 128000 tokens. However, you requested 240118 tokens (238118 in the messages, 2000 in the completion). Please reduce the length of the messages.\",\"code\":\"context_length_exceeded\"}}",
);

const chunkOf = (content: string): ChatCompletionChunk => ({
	id: "chunk",
	object: "chat.completion.chunk",
	created: 0,
	model: "test",
	choices: [
		{
			index: 0,
			delta: { role: "assistant", content },
			finish_reason: null,
		},
	],
});

const llmOf = (
	behaviour: (request: ChatCompletionRequest) => AsyncIterable<ChatCompletionChunk>,
) => ({
	getMaxModelTokens: async () => 128000,
	chatCompletions: behaviour as never,
});

/** Long enough that compaction has something to remove. */
const longConversation = () => ({
	messages: [
		{ role: "system" as const, content: "system prompt" },
		...Array.from({ length: 40 }, (_, index) => ({
			role: "user" as const,
			content: `question ${index} ${"x".repeat(4000)}`,
		})),
	],
	outputMessages: Array.from({ length: 20 }, (_, index) => ({
		role: "assistant" as const,
		content: `answer ${index} ${"y".repeat(4000)}`,
	})),
});

const lifecycleWithAutoCompact = () => {
	const lifecycle = createFlowRunLifecycle();
	lifecycle.onCompact("auto-compact", (state, request) =>
		compactToBudget(
			state as never,
			undefined,
			request.budgetTokens,
		) as never,
	);
	return lifecycle;
};

describe("streamAssistantTurn under a provider token budget", () => {
	it("caps the completion and retries instead of surfacing a credit refusal", async () => {
		const requested: Array<number | undefined> = [];
		let attempts = 0;
		const llm = llmOf(async function* (request) {
			requested.push(request.max_tokens);
			if (attempts++ === 0) throw OPENROUTER_402;
			yield chunkOf("recovered");
		});

		const turn = await streamAssistantTurn(longConversation(), {
			llm,
			tools: [],
		});

		expect(turn.content).toBe("recovered");
		expect(turn.compacted).toBe(false);
		// Unset means "the model's maximum", which is the number being refused —
		// so the retry has to state one, under the ceiling the provider quoted.
		expect(requested).toEqual([undefined, 51900]);
	});

	it("compacts the conversation when capping the completion is not enough", async () => {
		const before = longConversation();
		const promptSizes: number[] = [];
		const llm = llmOf(async function* (request) {
			const size = JSON.stringify(request.messages).length;
			promptSizes.push(size);
			if (size > 200_000) throw OPENROUTER_402;
			yield chunkOf("recovered after compaction");
		});

		const turn = await streamAssistantTurn(before, {
			llm,
			tools: [],
			lifecycle: lifecycleWithAutoCompact(),
		});

		expect(turn.content).toBe("recovered after compaction");
		expect(turn.compacted).toBe(true);
		expect(promptSizes.at(-1)).toBeLessThan(promptSizes[0]);
		// The caller gets the conversation the turn actually ran on, so the next
		// iteration does not rebuild the context the provider just refused.
		const kept =
			turn.conversation.messages.length +
			turn.conversation.outputMessages.length;
		expect(kept).toBeLessThan(
			before.messages.length + before.outputMessages.length,
		);
	});

	it("compacts on a context-window refusal", async () => {
		let attempts = 0;
		const llm = llmOf(async function* () {
			if (attempts++ === 0) throw CONTEXT_400;
			yield chunkOf("fits now");
		});

		const turn = await streamAssistantTurn(longConversation(), {
			llm,
			tools: [],
			lifecycle: lifecycleWithAutoCompact(),
		});

		expect(turn.content).toBe("fits now");
		expect(turn.compacted).toBe(true);
	});

	it("explains itself instead of replaying the provider blob once out of room", async () => {
		const llm = llmOf(async function* () {
			throw OPENROUTER_402;
		});

		await expect(
			streamAssistantTurn(
				{ messages: [{ role: "user", content: "hi" }], outputMessages: [] },
				{ llm, tools: [] },
			),
		).rejects.toMatchObject({
			name: "TokenBudgetError",
			limit: { kind: "credits", allowed: 52960 },
		});
	});

	it("stops after the attempt budget rather than retrying forever", async () => {
		const chatCompletions = vi.fn(async function* () {
			throw OPENROUTER_402;
			// biome-ignore lint/correctness/noUnreachable: generator needs a yield type
			yield chunkOf("");
		});

		await expect(
			streamAssistantTurn(longConversation(), {
				llm: {
					getMaxModelTokens: async () => 128000,
					chatCompletions: chatCompletions as never,
				},
				tools: [],
				lifecycle: lifecycleWithAutoCompact(),
				maxAttempts: 3,
			}),
		).rejects.toMatchObject({ name: "TokenBudgetError" });

		expect(chatCompletions).toHaveBeenCalledTimes(3);
	});

	it("does not replay a turn the reader has already seen part of", async () => {
		const onChunk = vi.fn();
		const chatCompletions = vi.fn(async function* () {
			yield chunkOf("half an answer");
			throw OPENROUTER_402;
		});

		await expect(
			streamAssistantTurn(longConversation(), {
				llm: {
					getMaxModelTokens: async () => 128000,
					chatCompletions: chatCompletions as never,
				},
				tools: [],
				onChunk,
			}),
		).rejects.toMatchObject({ name: "TokenBudgetError" });

		expect(chatCompletions).toHaveBeenCalledTimes(1);
		expect(onChunk).toHaveBeenCalledTimes(1);
	});

	it("leaves an error that is not about budget alone", async () => {
		const llm = llmOf(async function* () {
			throw new Error("500 Internal Server Error");
		});

		await expect(
			streamAssistantTurn({ messages: [], outputMessages: [] }, {
				llm,
				tools: [],
			}),
		).rejects.toThrow("500 Internal Server Error");
	});
});

describe("compactToBudget", () => {
	it("trims until the conversation fits the budget it was given", () => {
		const before = longConversation();
		const after = compactToBudget(before, undefined, 20_000);

		expect(after).toBeDefined();
		expect(
			after!.messages.length + after!.outputMessages.length,
		).toBeLessThan(before.messages.length + before.outputMessages.length);
	});

	it("reports nothing to do when the conversation already fits", () => {
		expect(
			compactToBudget(
				{ messages: [{ role: "user", content: "hi" }], outputMessages: [] },
				undefined,
				100_000,
			),
		).toBeUndefined();
	});
});
