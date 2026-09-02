import { describe, expect, it } from "vitest";
import "../steps/common/context-to-system.js";
import type { ChatCompletionMessageParam } from "../interfaces/engine/messages.js";
import { stepRegistry } from "../registries/step-registry.js";

const createStep = (config: { prompt?: string } = {}) => {
	const entry = stepRegistry.get("context-to-system");
	const step = entry?.factory?.({}, config);
	if (!step) throw new Error("context-to-system step is not registered");
	return step as {
		execute: (input: {
			messages: ChatCompletionMessageParam[];
			context: string;
		}) => Promise<{ output?: { messages?: ChatCompletionMessageParam[] } }>;
	};
};

const conversation: ChatCompletionMessageParam[] = [
	{ role: "system", content: "You are Memorall." },
	{ role: "user", content: "What did I read yesterday?" },
	{ role: "assistant", content: "An article about caching." },
	{ role: "user", content: "Summarize it." },
];

/**
 * Retrieved context differs on every turn. It used to be appended to the
 * system prompt, which is the first message of every request, so the provider's
 * prompt cache could never match a conversation's prefix twice. It now rides
 * on the newest user message, after everything that stays stable.
 */
describe("context-to-system step", () => {
	it("attaches the retrieved context to the latest user message only", async () => {
		const result = await createStep().execute({
			messages: conversation,
			context: "Fact: the article was about prompt caching.",
		});
		const messages = result.output?.messages ?? [];

		expect(messages[0]).toEqual(conversation[0]);
		expect(messages[1]).toEqual(conversation[1]);
		expect(messages[2]).toEqual(conversation[2]);
		expect(messages[3]?.role).toBe("user");
		expect(messages[3]?.content).toContain("Summarize it.");
		expect(messages[3]?.content).toContain(
			"Fact: the article was about prompt caching.",
		);
		expect(messages[3]?.content).toContain("<context>");
	});

	it("keeps the system prompt byte-identical across turns with different context", async () => {
		const step = createStep();
		const first = await step.execute({
			messages: conversation,
			context: "context for turn one",
		});
		const second = await step.execute({
			messages: conversation,
			context: "completely different context for turn two",
		});

		expect(first.output?.messages?.[0]).toEqual(second.output?.messages?.[0]);
	});

	it("honours a custom prompt template around the context", async () => {
		const result = await createStep({
			prompt: "Use this:\n{context}\nDone.",
		}).execute({
			messages: conversation,
			context: "CTX",
		});

		expect(result.output?.messages?.[3]?.content).toContain(
			"Use this:\nCTX\nDone.",
		);
	});

	it("leaves a conversation without a user message unchanged", async () => {
		const systemOnly: ChatCompletionMessageParam[] = [
			{ role: "system", content: "You are Memorall." },
		];
		const result = await createStep().execute({
			messages: systemOnly,
			context: "unused",
		});

		expect(result.output?.messages).toEqual(systemOnly);
	});
});
