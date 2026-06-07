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

/** Build a tool call flow: one assistant message with a tool call + one tool result. */
function makeFlow(
	id: string,
	resultContent: string,
	argContent = "{}",
): [
	(typeof messages)[0],
	(typeof messages)[1],
] {
	const messages = [
		{
			role: "assistant" as const,
			content: "",
			tool_calls: [
				{
					id,
					type: "function" as const,
					function: { name: "tool", arguments: argContent },
				},
			],
		},
		{
			role: "tool" as const,
			tool_call_id: id,
			content: resultContent,
		},
	];
	return messages as [typeof messages[0], typeof messages[1]];
}

/** Config that disables every stage except the ones explicitly enabled. */
const disabledTrim = { stepPercent: 100, maxPercent: 0 };
const fullTrim = { stepPercent: 100, maxPercent: 100 };

// ---------------------------------------------------------------------------
// tool result chunking
// ---------------------------------------------------------------------------

describe("tool result chunking", () => {
	it("chunks a large tool result and preserves head and tail", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Use a tool" }],
				outputMessages: [
					...makeFlow("call_1", `${"a".repeat(120)}middle${"z".repeat(120)}`),
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 10,
					chunkTailChars: 10,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const toolResult = result?.outputMessages[1];
		expect(toolResult?.content).toMatch(/^aaaaaaaaaa/);
		expect(toolResult?.content).toMatch(/zzzzzzzzzz$/);
		expect(toolResult?.content).toContain("[... chunked tool result:");
		// assistant tool call is preserved untouched
		expect(result?.outputMessages[0]).toEqual(
			expect.objectContaining({ role: "assistant", tool_calls: expect.any(Array) }),
		);
	});

	it("does not chunk a tool result that fits within head+tail chars", async () => {
		const shortContent = "short";
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "x".repeat(300) }],
				outputMessages: [...makeFlow("call_1", shortContent)],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 100,
					chunkTailChars: 100,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		// tool result is not chunkable — content unchanged
		expect(result?.outputMessages[1]?.content).toBe(shortContent);
	});

	it("does not re-chunk an already chunked tool result", async () => {
		const alreadyChunked =
			"start\n\n[... chunked tool result: originalChars=500, omittedChars=400 ...]\n\nend";
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Use a tool" }],
				outputMessages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "large_tool", arguments: "{}" },
							},
						],
					},
					{ role: "tool", tool_call_id: "call_1", content: alreadyChunked },
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 1,
					chunkTailChars: 1,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			20,
		);

		expect(result?.outputMessages[1]?.content).toBe(alreadyChunked);
	});

	it("chunks only the oldest eligible percent per step before escalating", async () => {
		// 5 flows, stepPercent=20 → first step chunks exactly 1 (20% of 5, ceil=1)
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Use tools" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`call_${i}`, `${"x".repeat(120)}${i}`),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [20],
				toolResultTrim: {
					stepPercent: 20,
					maxPercent: 20,
					chunkHeadChars: 4,
					chunkTailChars: 4,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const toolContents = result?.outputMessages
			.filter((m) => m.role === "tool")
			.map((m) => m.content as string);

		const chunked = toolContents?.filter((c) => c.includes("[... chunked tool result:"));
		expect(chunked).toHaveLength(1);
		expect(toolContents?.[0]).toContain("[... chunked tool result:");
		expect(toolContents?.[1]).not.toContain("[... chunked tool result:");
	});
});

// ---------------------------------------------------------------------------
// tool call flow removal
// ---------------------------------------------------------------------------

describe("tool call flow removal", () => {
	it("removes the oldest tool call flow (assistant + tool result together)", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Continue" }],
				outputMessages: [
					...makeFlow("call_1", "x".repeat(400)),
					...makeFlow("call_2", "y".repeat(400)),
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

		// call_1 removed, call_2 kept
		const toolCallIds = result?.outputMessages
			.filter((m) => m.role === "tool")
			.map((m) => (m as { tool_call_id: string }).tool_call_id);
		expect(toolCallIds).not.toContain("call_1");
		expect(toolCallIds).toContain("call_2");
	});

	it("escalates to tool call flow removal when tool result chunking reaches max", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Continue" }],
				outputMessages: [
					...makeFlow(
						"call_1",
						"x".repeat(400),
						JSON.stringify({ value: "x".repeat(400) }),
					),
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.1,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 0,
					chunkHeadChars: 10,
					chunkTailChars: 10,
				},
				toolCallFlowTrim: { stepPercent: 100, maxPercent: 100 },
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		expect(result?.outputMessages).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// chat message trimming (last resort)
// ---------------------------------------------------------------------------

describe("chat message trimming", () => {
	it("removes old user and assistant chat messages while preserving the latest user message", async () => {
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
				chatMessageTrim: { stepPercent: 100, maxPercent: 100 },
			},
			120,
		);

		expect(result?.messages).toEqual([{ role: "user", content: "latest question" }]);
		expect(result?.outputMessages).toEqual([]);
	});

	it("does not trim chat messages when tool result chunking alone reaches safe threshold", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(10) },
					{ role: "assistant", content: "old answer ".repeat(10) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [...makeFlow("call_1", "x".repeat(500))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: { stepPercent: 100, maxPercent: 100 },
			},
			400,
		);

		// chat messages should survive — tool result chunking was enough
		const roles = result?.messages.map((m) => m.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
		// tool result was chunked
		expect(result?.outputMessages[1]?.content).toContain("[... chunked tool result:");
	});
});

// ---------------------------------------------------------------------------
// round-based escalation
// ---------------------------------------------------------------------------

describe("round-based escalation", () => {
	it("interleaves toolResult and toolCallFlow per round before escalating cap", async () => {
		// 4 flows, each with a large tool result.
		// Round 1 (cap=50%): toolResult chunks 50% (2 results), toolCallFlow removes 50% (2 flows).
		// If safe threshold is reached during round 1, we stop — so set threshold very low.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01, // very low — won't be reached during trim
				maxRoundPercentSteps: [50, 100],
				toolResultTrim: {
					stepPercent: 50,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: { stepPercent: 50, maxPercent: 100 },
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		// After round 1 (cap=50%): 2 tool results chunked, 2 flows removed.
		// After round 2 (cap=100%): remaining 2 results chunked, remaining 2 flows removed.
		// All flows gone.
		expect(result?.outputMessages).toEqual([]);
	});

	it("stops mid-round when safe threshold is reached without exhausting the cap", async () => {
		// 5 flows — only need to chunk 1 result to drop below safe threshold.
		// Round 1 cap=100%, stepPercent=20% → first step chunks 20% (1 item) → safe.
		// toolCallFlow should NOT be touched.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				// safe threshold reachable after chunking 1 result
				safeThresholdRatio: 0.49,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 20,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: { stepPercent: 100, maxPercent: 100 },
				chatMessageTrim: disabledTrim,
			},
			// maxTokens sized so that chunking 1 result drops below safe threshold
			// 5 flows × ~50 chars each ≈ 250 chars. safe = 0.49 × maxTokens.
			// Set maxTokens = 70 → safe = ~34 tokens. After chunking 1 result
			// (~200 chars → ~10 chars), total drops enough.
			70,
		);

		// At least some tool call flows are still present (toolCallFlow never ran)
		const remainingFlows = result?.outputMessages.filter(
			(m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length,
		);
		expect(remainingFlows?.length).toBeGreaterThan(0);

		// Exactly 1 result was chunked (first step = 20% of 5 = 1)
		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(1);
	});

	it("round 2 restarts fresh so eligibleCount reflects items remaining after round 1", async () => {
		// 4 tool results. Round 1 cap=50% → chunks 2. Round 2 cap=100% → eligible=2 remaining.
		// stepPercent=100 → round 2 chunks all 2 remaining in one step.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [50, 100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		// All 4 results chunked across 2 rounds
		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(4);
		// All 4 tool call assistant messages still present (only results chunked)
		const flows = result?.outputMessages.filter(
			(m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length,
		);
		expect(flows?.length).toBe(4);
	});

	it("maxRoundPercentSteps cap limits how many items are processed in that round", async () => {
		// 10 tool results. Only round with cap=30% → chunks ceil(10×30%)=3.
		// toolCallFlow disabled. chatMessage disabled.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [30],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(3); // ceil(10 × 30%) = 3
	});

	it("respects toolResultTrim.maxPercent even when roundCap is higher", async () => {
		// toolResultTrim.maxPercent=30 but roundCap=100 → effective cap=min(30,100)=30%.
		// 10 results → chunks ceil(10×30%)=3.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 30,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// messages processed before outputMessages
// ---------------------------------------------------------------------------

describe("messages processed before outputMessages", () => {
	it("exhausts all messages stages before touching outputMessages", async () => {
		// messages: large tool call flow + old chat messages + latest user question
		// outputMessages: current tool flow (small — not chunkable)
		// After cleaning messages, token count drops below safe threshold
		// → outputMessages must be untouched.
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					...makeFlow("hist_call", "h".repeat(400)),
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [
					...makeFlow("curr_call", "small"),
				],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			500,
		);

		// messages cleaned down to just the latest user question
		expect(result?.messages).toEqual([{ role: "user", content: "latest question" }]);
		// outputMessages untouched — "small" is below chunkable threshold
		expect(result?.outputMessages).toEqual(expect.arrayContaining([
			expect.objectContaining({ role: "tool", content: "small" }),
		]));
	});

	it("only touches outputMessages when messages stages cannot reach safe threshold alone", async () => {
		// messages: one small chat message (not enough to reduce tokens significantly)
		// outputMessages: large tool call flow
		// Expected: after messages stages fail, outputMessages tool flow is removed.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "latest question" }],
				outputMessages: [
					...makeFlow("big_call", "x".repeat(600)),
				],
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

		// outputMessages tool flow removed (messages had nothing to trim)
		expect(result?.outputMessages).toEqual([]);
		// latest user message preserved
		expect(result?.messages).toEqual([{ role: "user", content: "latest question" }]);
	});

	it("removes outputMessages tool call flows before trimming chat messages from messages", async () => {
		// messages: several chat turns (no tool calls — cannot be chunked)
		// outputMessages: large tool call flow
		// Priority: outputMessages toolCallFlow should be removed BEFORE
		// messages chatMessage is touched.
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question 1 ".repeat(20) },
					{ role: "assistant", content: "answer 1 ".repeat(20) },
					{ role: "user", content: "question 2 ".repeat(20) },
					{ role: "assistant", content: "answer 2 ".repeat(20) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [...makeFlow("big_call", "x".repeat(500))],
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

		// outputMessages tool flow should be gone
		const outputFlows = result?.outputMessages.filter(
			(m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length,
		);
		expect(outputFlows?.length).toBe(0);

		// messages chat should still have the latest user message
		expect(result?.messages.some((m) => m.content === "latest question")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// chatMessage is last resort
// ---------------------------------------------------------------------------

describe("chatMessage is last resort", () => {
	it("does not touch chat messages when tool result chunking alone is sufficient", async () => {
		// messages: chat turns
		// outputMessages: one very large tool result
		// Chunking the tool result should be enough to reach safe threshold.
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question" },
					{ role: "assistant", content: "answer" },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("call_1", "x".repeat(800))],
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: fullTrim,
			},
			400,
		);

		// All original chat messages preserved
		expect(result?.messages).toHaveLength(3);
		// Tool result was chunked
		expect(result?.outputMessages[1]?.content).toContain("[... chunked tool result:");
	});

	it("does not touch chat messages when tool call flow removal alone is sufficient", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question ".repeat(5) },
					{ role: "assistant", content: "answer ".repeat(5) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("call_1", "x".repeat(600))],
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

		// chat messages untouched — flow removal was enough
		expect(result?.messages).toHaveLength(3);
		expect(result?.outputMessages).toEqual([]);
	});

	it("trims chat messages only after all rounds of tool trims for messages are exhausted", async () => {
		// messages: tool call flow + chat messages
		// outputMessages: empty
		// Round 1 toolCallFlow removes 50% (1 flow). Still above threshold.
		// Round 2 toolCallFlow removes remaining 50% (1 flow). Still above threshold.
		// chatMessageTrim then removes old chat messages.
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					...makeFlow("hist_1", "x".repeat(200)),
					...makeFlow("hist_2", "x".repeat(200)),
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

		// All tool flows and chat messages removed, latest user preserved
		const remainingFlows = result?.messages.filter(
			(m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length,
		);
		expect(remainingFlows?.length).toBe(0);
		expect(result?.messages).toEqual([{ role: "user", content: "latest" }]);
	});
});

// ---------------------------------------------------------------------------
// config resolution
// ---------------------------------------------------------------------------

describe("config resolution", () => {
	it("uses default maxRoundPercentSteps [50, 100] when not provided", async () => {
		// Verified indirectly: with 4 tool results and default steps,
		// round 1 (cap=50%) chunks 2, round 2 (cap=100%) chunks remaining 2.
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
				// maxRoundPercentSteps not set → default [50, 100]
			},
			200,
		);

		// All 4 chunked across 2 rounds
		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(4);
	});

	it("deduplicates, sorts, and filters invalid maxRoundPercentSteps entries", async () => {
		// [100, 50, 50, -10, NaN, 100] → valid: [50, 100]
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100, 50, 50, -10, NaN, 100] as number[],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		// Should behave identically to [50, 100] — all 4 results chunked
		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(4);
	});

	it("falls back to default maxRoundPercentSteps when array is empty", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "start" }],
				outputMessages: Array.from({ length: 2 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(200)),
				).flat(),
			},
			fakeLLM,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		const chunked = result?.outputMessages.filter(
			(m) => m.role === "tool" && (m.content as string).includes("[... chunked tool result:"),
		);
		expect(chunked?.length).toBe(2);
	});

	it("returns undefined when below compact threshold", async () => {
		const result = await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "small" }],
				outputMessages: [],
			},
			fakeLLM,
			{ compactThresholdRatio: 0.9, safeThresholdRatio: 0.5 },
			10000,
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined for invalid maxTokens", async () => {
		const r1 = await applyAutoCompactPolicy(
			{ messages: [], outputMessages: [] },
			fakeLLM,
			{},
			0,
		);
		expect(r1).toBeUndefined();

		const r2 = await applyAutoCompactPolicy(
			{ messages: [], outputMessages: [] },
			fakeLLM,
			{},
			NaN,
		);
		expect(r2).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// LLM summarization path
// ---------------------------------------------------------------------------

describe("LLM summarization", () => {
	it("does not call LLM when direct trims reach safe threshold", async () => {
		const llm = createFakeLLM();
		await applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "Use a tool" }],
				outputMessages: [...makeFlow("call_1", "x".repeat(400))],
			},
			llm,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 100,
					chunkHeadChars: 10,
					chunkTailChars: 10,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		expect(llm.chatCompletions).not.toHaveBeenCalled();
	});

	it("calls LLM summarization when direct trims cannot reach safe threshold", async () => {
		const llm = createFakeLLM("short summary");
		const result = await applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`call_${i}`, "x".repeat(300)),
				).flat(),
			},
			llm,
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 100,
					maxPercent: 0,
					chunkHeadChars: 10,
					chunkTailChars: 10,
				},
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: disabledTrim,
			},
			200,
		);

		expect(llm.chatCompletions).toHaveBeenCalled();
		expect(result?.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "assistant",
					content: expect.stringContaining("[Conversation history summary]"),
				}),
				{ role: "user", content: "latest question" },
			]),
		);
	});
});
