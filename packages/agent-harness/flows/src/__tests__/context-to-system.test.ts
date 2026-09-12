import { describe, expect, it } from "vitest";
import "../steps/common/context-to-system.js";
import { KNOWLEDGE_RETRIEVAL_TOOL_NAME } from "../steps/common/context-to-system.js";
import type { ChatCompletionMessageParam } from "../interfaces/engine/messages.js";
import { stepRegistry } from "../registries/step-registry.js";

type Emitted = { type: string; chunk?: unknown };

const createStep = (config: { prompt?: string } = {}) => {
	const entry = stepRegistry.get("context-to-system");
	const step = entry?.factory?.({}, config);
	if (!step) throw new Error("context-to-system step is not registered");
	return step as {
		execute: (
			input: { messages: ChatCompletionMessageParam[]; context: string },
			runConfig?: { writer?: (payload: Emitted) => void },
		) => Promise<{ output?: { messages?: ChatCompletionMessageParam[] } }>;
	};
};

const conversation: ChatCompletionMessageParam[] = [
	{ role: "system", content: "You are Memorall." },
	{ role: "user", content: "What did I read yesterday?" },
	{ role: "assistant", content: "An article about caching." },
	{ role: "user", content: "Summarize it." },
];

const run = async (context: string, config: { prompt?: string } = {}) => {
	const emitted: Emitted[] = [];
	const result = await createStep(config).execute(
		{ messages: conversation, context },
		{ writer: (payload) => emitted.push(payload) },
	);
	return { messages: result.output?.messages ?? [], emitted };
};

/**
 * Retrieved knowledge differs every turn, so where it goes decides whether the
 * provider's prompt cache can match a conversation's prefix twice.
 *
 * It was appended to the system prompt first, which rewrote the first message
 * of every request. It moved to the newest user message next, which looked
 * right but rewrote a position the following turn reads through. It is now
 * appended as its own retrieval turn, which only ever grows the conversation at
 * the end — and, because it is emitted as stream chunks, is stored and replayed
 * verbatim instead of being rebuilt differently next time.
 */
describe("context-to-system step", () => {
	it("appends the retrieval as its own turn, leaving the prefix untouched", async () => {
		const { messages } = await run("Fact: the article was about caching.");

		expect(messages.slice(0, conversation.length)).toEqual(conversation);
		expect(messages).toHaveLength(conversation.length + 2);

		const [assistant, tool] = messages.slice(-2);
		expect(assistant?.role).toBe("assistant");
		expect(assistant?.tool_calls?.[0]?.function.name).toBe(
			KNOWLEDGE_RETRIEVAL_TOOL_NAME,
		);
		expect(tool?.role).toBe("tool");
		expect(tool?.content).toContain("Fact: the article was about caching.");
		expect(tool?.tool_call_id).toBe(assistant?.tool_calls?.[0]?.id);
	});

	it("emits the retrieval so it is stored and replayed next turn", async () => {
		const { messages, emitted } = await run("CTX");

		// Without these chunks the pair would live only in this request, and the
		// next turn would rebuild the conversation without it — diverging at a
		// position the whole turn sits behind.
		expect(emitted).toHaveLength(2);
		expect(emitted.every((payload) => payload.type === "llm")).toBe(true);

		const deltas = emitted.map(
			(payload) =>
				(payload.chunk as { choices: { delta: Record<string, unknown> }[] })
					.choices[0]!.delta,
		);
		const [assistant, tool] = messages.slice(-2);

		// The stored shape has to equal what was put in `messages`, or the replay
		// differs from what was cached.
		expect(deltas[0]!.role).toBe("assistant");
		expect(deltas[0]!.content).toBe(assistant?.content);
		expect(deltas[1]!.tool_call_id).toBe(tool?.tool_call_id);
		expect(deltas[1]!.content).toBe(tool?.content);
	});

	it("uses empty-string content so the replayed assistant part matches", async () => {
		const { messages } = await run("CTX");
		// The accumulator rebuilds assistant parts with "" — null here would
		// serialize differently on the turn that replays it.
		expect(messages.at(-2)?.content).toBe("");
	});

	it("honours a custom prompt template around the context", async () => {
		const { messages } = await run("CTX", {
			prompt: "Use this:\n{context}\nDone.",
		});
		expect(messages.at(-1)?.content).toContain("Use this:\nCTX\nDone.");
	});
});
