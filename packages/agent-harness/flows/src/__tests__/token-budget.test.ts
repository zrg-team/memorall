import { describe, expect, it } from "vitest";
import {
	describeTokenBudgetLimit,
	nextCompletionBudget,
	parseTokenBudgetLimit,
	promptBudgetFromLimit,
	providerMessageOf,
	TokenBudgetError,
	withClampAttempt,
} from "../utils/token-budget.js";

const OPENROUTER_402 =
	'OpenAI streaming completion failed: 402  {"error":{"message":"This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 52960. To increase, visit https://openrouter.ai/settings/credits and add more credits","code":402}}';

const OPENAI_CONTEXT_400 =
	"400 Bad Request {\"error\":{\"message\":\"This model's maximum context length is 128000 tokens. However, you requested 240118 tokens (238118 in the messages, 2000 in the completion). Please reduce the length of the messages.\",\"code\":\"context_length_exceeded\"}}";

describe("parseTokenBudgetLimit", () => {
	it("reads the affordable ceiling out of an OpenRouter credit refusal", () => {
		expect(parseTokenBudgetLimit(new Error(OPENROUTER_402))).toMatchObject({
			kind: "credits",
			allowed: 52960,
			requested: 65536,
		});
	});

	it("reads the window and the prompt count out of a context refusal", () => {
		expect(parseTokenBudgetLimit(OPENAI_CONTEXT_400)).toMatchObject({
			kind: "context",
			allowed: 128000,
			requested: 240118,
			promptTokens: 238118,
		});
	});

	it("reads a max_tokens ceiling in either wording", () => {
		expect(
			parseTokenBudgetLimit("max_tokens: 40000 > 32000, which is the maximum"),
		).toMatchObject({ kind: "max-tokens", requested: 40000, allowed: 32000 });

		expect(
			parseTokenBudgetLimit(
				"max_tokens must be less than or equal to 8192 for this model",
			),
		).toMatchObject({ kind: "max-tokens", allowed: 8192 });
	});

	it("still classifies a refusal that names no number", () => {
		expect(parseTokenBudgetLimit("insufficient_quota for this key")).toMatchObject(
			{ kind: "credits" },
		);
		expect(
			parseTokenBudgetLimit("Please reduce the length of the messages"),
		).toMatchObject({ kind: "context" });
	});

	it("leaves errors that are not about budget alone", () => {
		expect(parseTokenBudgetLimit(new Error("500 Internal Server Error"))).toBeUndefined();
		expect(parseTokenBudgetLimit(undefined)).toBeUndefined();
	});

	it("takes the already-parsed limit off a TokenBudgetError", () => {
		const limit = { kind: "credits", allowed: 100, detail: "d" } as const;
		expect(parseTokenBudgetLimit(new TokenBudgetError("m", limit))).toBe(limit);
	});
});

describe("nextCompletionBudget", () => {
	const limit = parseTokenBudgetLimit(OPENROUTER_402)!;

	it("proposes a ceiling under what the provider refused", () => {
		expect(nextCompletionBudget(limit)).toBe(51900);
	});

	it("refuses to propose a ceiling that was already tried", () => {
		// Retrying at the same number produces the same refusal.
		expect(nextCompletionBudget(limit, 51900)).toBeUndefined();
		expect(
			nextCompletionBudget(withClampAttempt(limit, 51900)),
		).toBeUndefined();
	});

	it("gives up when the ceiling leaves no room to answer in", () => {
		expect(
			nextCompletionBudget({ kind: "credits", allowed: 40, detail: "" }),
		).toBeUndefined();
	});
});

describe("promptBudgetFromLimit", () => {
	it("leaves room for a reply inside a stated context window", () => {
		const limit = parseTokenBudgetLimit(OPENAI_CONTEXT_400)!;
		expect(
			promptBudgetFromLimit(limit, { currentPromptTokens: 238118 }),
		).toBe(96000);
	});

	it("shrinks relative to the current prompt when no count is given", () => {
		// A fixed fraction of the context window is a no-op on a conversation
		// already under it — and that is exactly the one still being refused.
		const limit = { kind: "credits", detail: "" } as const;
		expect(
			promptBudgetFromLimit(limit, {
				contextTokens: 128000,
				currentPromptTokens: 50000,
			}),
		).toBe(30000);
	});

	it("has nothing to propose without either number", () => {
		expect(
			promptBudgetFromLimit({ kind: "credits", detail: "" }, {}),
		).toBeUndefined();
	});
});

describe("describeTokenBudgetLimit", () => {
	it("says what to do, then keeps the provider's own sentence and link", () => {
		const limit = parseTokenBudgetLimit(OPENROUTER_402)!;
		const message = describeTokenBudgetLimit(limit);

		expect(message).toContain("Add credit");
		expect(message).toContain("https://openrouter.ai/settings/credits");
		// The HTTP wrapper and the JSON envelope are what made it unreadable.
		expect(message).not.toContain("402");
		expect(message).not.toContain('{"error"');
	});

	it("unwraps a provider message from its envelope", () => {
		expect(providerMessageOf('402 {"error":{"message":"nope"}}')).toBe("nope");
		expect(providerMessageOf("plain text")).toBe("plain text");
	});
});
