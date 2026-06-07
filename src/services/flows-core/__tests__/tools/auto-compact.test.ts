import { describe, expect, it, vi } from "vitest";
import {
	applyAutoCompactPolicy,
	type AutoCompactConfig,
} from "flow-core/steps/features/auto-compact";
import type { ChatCompletionResponse } from "flow-core/interfaces/engine/messages";
import type { BaseLLM } from "flow-core/interfaces/services/llm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createFakeLLM = (summary = "summary"): BaseLLM => ({
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 4096,
	getMaxResponseTokens: async () => 1024,
	chatCompletions: vi.fn(
		async (): Promise<ChatCompletionResponse> => ({
			id: "summary",
			object: "chat.completion",
			created: 1,
			model: "test-model",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: summary },
					finish_reason: "stop",
				},
			],
		}),
	),
});

const fakeLLM = createFakeLLM();

import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";

function makeFlow(id: string, resultContent: string, argContent = "{}"): ChatCompletionMessageParam[] {
	return [
		{
			role: "assistant",
			content: "",
			tool_calls: [
				{
					id,
					type: "function",
					function: { name: "tool", arguments: argContent },
				},
			],
		},
		{
			role: "tool",
			tool_call_id: id,
			content: resultContent,
		},
	];
}

const disabledTrim = { stepPercent: 100, maxPercent: 0 };
const fullTrim = { stepPercent: 100, maxPercent: 100 };

// ---------------------------------------------------------------------------
// tool result chunking — structural assertions (behavior is unambiguous)
// ---------------------------------------------------------------------------

describe("tool result chunking", () => {
	it("chunks a large tool result preserving head and tail content", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					...makeFlow("c1", `${"a".repeat(120)}MIDDLE${"z".repeat(120)}`),
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 10, chunkTailChars: 10 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const toolMsg = result?.outputMessages[1];
		// head and tail preserved, middle omitted
		expect(toolMsg?.content).toMatch(/^aaaaaaaaaa/);
		expect(toolMsg?.content).toMatch(/zzzzzzzzzz$/);
		expect(toolMsg?.content).toContain("[... chunked tool result:");
		// assistant side untouched
		expect(result?.outputMessages[0]).toEqual(
			expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
		);
	});

	it("does not chunk a result that fits within head+tail chars", async () => {
		const short = "tiny";
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "x".repeat(300) }],
				outputMessages: [...makeFlow("c1", short)],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 100, chunkTailChars: 100 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		expect(result?.outputMessages[1]?.content).toBe(short);
	});

	it("does not re-chunk an already chunked tool result", async () => {
		const already = "start\n\n[... chunked tool result: originalChars=500, omittedChars=400 ...]\n\nend";
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
					},
					{ role: "tool", tool_call_id: "c1", content: already },
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 1, chunkTailChars: 1 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			20,
		);

		expect(result?.outputMessages[1]?.content).toBe(already);
	});
});

// ---------------------------------------------------------------------------
// chat message trimming — structural assertions
// ---------------------------------------------------------------------------

describe("chat message trimming", () => {
	it("removes old chat messages while preserving the latest user message", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: fullTrim,
			},
			120,
		);

		expect(result?.messages).toEqual([{ role: "user", content: "latest question" }]);
		expect(result?.outputMessages).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// policy guard rails — structural assertions
// ---------------------------------------------------------------------------

describe("policy guard rails", () => {
	it("returns undefined when below compact threshold", async () => {
		const result = await applyAutoCompactPolicy(
			{ messages: [{ role: "user", content: "small" }], outputMessages: [] },
			fakeLLM,
			{ compactThresholdRatio: 0.9, safeThresholdRatio: 0.5 },
			10000,
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined for maxTokens=0", async () => {
		expect(
			await applyAutoCompactPolicy({ messages: [], outputMessages: [] }, fakeLLM, {}, 0),
		).toBeUndefined();
	});

	it("returns undefined for maxTokens=NaN", async () => {
		expect(
			await applyAutoCompactPolicy({ messages: [], outputMessages: [] }, fakeLLM, {}, NaN),
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// LLM summarization — structural assertions
// ---------------------------------------------------------------------------

describe("LLM summarization", () => {
	it("does not call LLM when direct trim reaches safe threshold", async () => {
		const llm = createFakeLLM();
		await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [...makeFlow("c1", "x".repeat(400))],
			},
			llm,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 10, chunkTailChars: 10 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(llm.chatCompletions).not.toHaveBeenCalled();
	});

	it("calls LLM when direct trims cannot reach safe threshold", async () => {
		const llm = createFakeLLM("short summary");
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(300)),
				).flat(),
			},
			llm,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 0, chunkHeadChars: 10, chunkTailChars: 10 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(llm.chatCompletions).toHaveBeenCalled();
		expect(result?.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ content: expect.stringContaining("[Conversation history summary]") }),
				{ role: "user", content: "latest question" },
			]),
		);
	});
});

// ---------------------------------------------------------------------------
// snapshot tests — complex trim ordering and escalation
// ---------------------------------------------------------------------------

describe("tool result chunking — snapshot", () => {
	it("chunks oldest results first, stepPercent controls how many per step", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`c${i}`, `${"x".repeat(100)}[${i}]${"x".repeat(100)}`),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 20, maxPercent: 20, chunkHeadChars: 4, chunkTailChars: 4 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("tool call flow removal — snapshot", () => {
	it("removes oldest flow first, preserves newer flows", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					...makeFlow("old", "x".repeat(400)),
					...makeFlow("new", "y".repeat(400)),
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.1,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: { stepPercent: 50, maxPercent: 50 },
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("escalates to flow removal when tool result chunking is disabled", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [...makeFlow("c1", "x".repeat(400))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.1,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 0, chunkHeadChars: 10, chunkTailChars: 10 },
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("round-based escalation — snapshot", () => {
	it("interleaves toolResult and toolCallFlow per round across two rounds", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [50, 100],
				toolResultTrim: { stepPercent: 50, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: { stepPercent: 50, maxPercent: 100 },
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("stops mid-round when safe threshold is reached — remaining items untouched", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.49,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 20, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: disabledTrim,
			},
			70,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("round 2 restarts with only items remaining after round 1", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [50, 100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("roundCap limits items processed even when stage maxPercent is higher", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [30],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("stage maxPercent caps items even when roundCap is higher", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 30, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("messages processed before outputMessages — snapshot", () => {
	it("fully exhausts messages stages before touching outputMessages", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					...makeFlow("hist", "h".repeat(400)),
					{ role: "user", content: "old ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("curr", "small")],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			500,
		);
		expect(result).toMatchSnapshot();
	});

	it("only trims outputMessages after messages stages cannot reach safe threshold", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "latest" }],
				outputMessages: [...makeFlow("big", "x".repeat(600))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.1,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result).toMatchSnapshot();
	});

	it("removes outputMessages tool flows before trimming messages chat messages", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "q1 ".repeat(20) },
					{ role: "assistant", content: "a1 ".repeat(20) },
					{ role: "user", content: "q2 ".repeat(20) },
					{ role: "assistant", content: "a2 ".repeat(20) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("big", "x".repeat(500))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			400,
		);
		expect(result).toMatchSnapshot();
	});
});

describe("chatMessage is last resort — snapshot", () => {
	it("does not trim chat messages when tool result chunking is sufficient", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question" },
					{ role: "assistant", content: "answer" },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("c1", "x".repeat(800))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: fullTrim,
			},
			400,
		);
		expect(result).toMatchSnapshot();
	});

	it("does not trim chat messages when flow removal is sufficient", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question ".repeat(5) },
					{ role: "assistant", content: "answer ".repeat(5) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("c1", "x".repeat(600))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			300,
		);
		expect(result).toMatchSnapshot();
	});

	it("trims chat messages only after all tool trim rounds exhausted", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					...makeFlow("h1", "x".repeat(200)),
					...makeFlow("h2", "x".repeat(200)),
					{ role: "user", content: "old question ".repeat(20) },
					{ role: "assistant", content: "old answer ".repeat(20) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [50, 100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			200,
		);
		expect(result).toMatchSnapshot();
	});
});

describe("config resolution — snapshot", () => {
	it("default maxRoundPercentSteps [50, 100] applied when not provided", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("deduplicates and sorts invalid maxRoundPercentSteps, behaves as [50, 100]", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100, 50, 50, -10, NaN, 100] as number[],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("empty maxRoundPercentSteps falls back to default [50, 100]", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [],
				toolResultTrim: { stepPercent: 100, maxPercent: 100, chunkHeadChars: 5, chunkTailChars: 5 },
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});
});
