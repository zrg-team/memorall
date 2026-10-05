import { describe, expect, it } from "vitest";
import {
	applyAutoCompactPolicy,
	applyStickyAutoCompact,
	type CompactionMemory,
} from "../../steps/features/auto-compact.js";
import type { ChatCompletionMessageParam } from "../../interfaces/engine/messages.js";
import { estimatePromptTokens } from "../../utils/token-usage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlow(
	id: string,
	resultContent: string,
	argContent = "{}",
): ChatCompletionMessageParam[] {
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
	it("chunks a large tool result preserving head and tail content", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					...makeFlow("c1", `${"a".repeat(120)}MIDDLE${"z".repeat(120)}`),
				],
			},
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

		const toolMsg = result?.outputMessages[1];
		// head and tail preserved, middle omitted
		expect(toolMsg?.content).toMatch(/^aaaaaaaaaa/);
		expect(toolMsg?.content).toMatch(/zzzzzzzzzz$/);
		expect(toolMsg?.content).toContain("[... chunked tool result:");
		// assistant side untouched
		expect(result?.outputMessages[0]).toEqual(
			expect.objectContaining({
				role: "assistant",
				tool_calls: expect.any(Array),
			}),
		);
	});

	it("does not chunk a result that fits within head+tail chars", () => {
		const short = "tiny";
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "x".repeat(300) }],
				outputMessages: [...makeFlow("c1", short)],
			},
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
			120,
		);

		expect(result?.outputMessages[1]?.content).toBe(short);
	});

	it("does not re-chunk an already chunked tool result", () => {
		const already =
			"start\n\n[... chunked tool result: originalChars=500, omittedChars=400 ...]\n\nend";
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "c1",
								type: "function",
								function: { name: "t", arguments: "{}" },
							},
						],
					},
					{ role: "tool", tool_call_id: "c1", content: already },
				],
			},
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

		expect(result?.outputMessages[1]?.content).toBe(already);
	});
});

// ---------------------------------------------------------------------------
// chat message trimming — structural assertions
// ---------------------------------------------------------------------------

describe("chat message trimming", () => {
	it("removes old chat messages while preserving the latest user message", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [],
			},
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

		expect(result?.messages).toEqual([
			{ role: "user", content: "latest question" },
		]);
		expect(result?.outputMessages).toEqual([]);
	});

	it("never removes or rewrites a reminder once it was sent", () => {
		const earlier = {
			role: "user" as const,
			content: "<system-reminder>\nTasks: #10 (1/4)\n</system-reminder>",
		};
		// Sent after the latest question: it must not take that question's
		// protection, and must not be stripped of anything it carries.
		const current = {
			role: "user" as const,
			content:
				"<system-reminder>\nScreenshot: data:image/png;base64,AAAA\n</system-reminder>",
		};
		const result = applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "old question ".repeat(30) },
					earlier,
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest question" },
				],
				outputMessages: [current],
			},
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.1,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: disabledTrim,
				chatMessageTrim: fullTrim,
				smartTrim: fullTrim,
			},
			120,
		);

		expect(result?.messages).toEqual([
			earlier,
			{ role: "user", content: "latest question" },
		]);
		expect(result?.outputMessages).toEqual([current]);
	});
});

// ---------------------------------------------------------------------------
// policy guard rails — structural assertions
// ---------------------------------------------------------------------------

describe("policy guard rails", () => {
	it("returns undefined when below compact threshold", () => {
		const result = applyAutoCompactPolicy(
			{ messages: [{ role: "user", content: "small" }], outputMessages: [] },
			{ compactThresholdRatio: 0.9, safeThresholdRatio: 0.5 },
			10000,
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined for maxTokens=0", () => {
		expect(
			applyAutoCompactPolicy({ messages: [], outputMessages: [] }, {}, 0),
		).toBeUndefined();
	});

	it("returns undefined for maxTokens=NaN", () => {
		expect(
			applyAutoCompactPolicy({ messages: [], outputMessages: [] }, {}, NaN),
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// snapshot tests — complex trim ordering and escalation
// ---------------------------------------------------------------------------

describe("tool result chunking — snapshot", () => {
	it("chunks oldest results first, stepPercent controls how many per step", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`c${i}`, `${"x".repeat(100)}[${i}]${"x".repeat(100)}`),
				).flat(),
			},
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
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
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("tool call flow removal — snapshot", () => {
	it("removes oldest flow first, preserves newer flows", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [
					...makeFlow("old", "x".repeat(400)),
					...makeFlow("new", "y".repeat(400)),
				],
			},
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

	it("escalates to flow removal when tool result chunking is disabled", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: [...makeFlow("c1", "x".repeat(400))],
			},
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
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: disabledTrim,
			},
			150,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("round-based escalation — snapshot", () => {
	it("interleaves toolResult and toolCallFlow per round across two rounds", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.01,
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
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("stops mid-round when safe threshold is reached — remaining items untouched", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 5 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.49,
				maxRoundPercentSteps: [100],
				toolResultTrim: {
					stepPercent: 20,
					maxPercent: 100,
					chunkHeadChars: 5,
					chunkTailChars: 5,
				},
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: disabledTrim,
			},
			70,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("round 2 restarts with only items remaining after round 1", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("roundCap limits items processed even when stage maxPercent is higher", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("stage maxPercent caps items even when roundCap is higher", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 10 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

describe("messages processed before outputMessages — snapshot", () => {
	it("fully exhausts messages stages before touching outputMessages", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [
					...makeFlow("hist", "h".repeat(400)),
					{ role: "user", content: "old ".repeat(30) },
					{ role: "assistant", content: "old answer ".repeat(30) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("curr", "small")],
			},
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
		expect(result).toMatchSnapshot();
	});

	it("only trims outputMessages after messages stages cannot reach safe threshold", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "latest" }],
				outputMessages: [...makeFlow("big", "x".repeat(600))],
			},
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

	it("removes outputMessages tool flows before trimming messages chat messages", () => {
		const result = applyAutoCompactPolicy(
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
	it("does not trim chat messages when tool result chunking is sufficient", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question" },
					{ role: "assistant", content: "answer" },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("c1", "x".repeat(800))],
			},
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
			280,
		);
		expect(result).toMatchSnapshot();
	});

	it("does not trim chat messages when flow removal is sufficient", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [
					{ role: "user", content: "question ".repeat(5) },
					{ role: "assistant", content: "answer ".repeat(5) },
					{ role: "user", content: "latest" },
				],
				outputMessages: [...makeFlow("c1", "x".repeat(600))],
			},
			{
				compactThresholdRatio: 0.5,
				safeThresholdRatio: 0.5,
				maxRoundPercentSteps: [100],
				toolResultTrim: disabledTrim,
				toolCallFlowTrim: fullTrim,
				chatMessageTrim: fullTrim,
			},
			260,
		);
		expect(result).toMatchSnapshot();
	});

	it("trims chat messages only after all tool trim rounds exhausted", () => {
		const result = applyAutoCompactPolicy(
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
	it("default maxRoundPercentSteps [50, 100] applied when not provided", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
			},
			200,
		);
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("deduplicates and sorts invalid maxRoundPercentSteps, behaves as [50, 100]", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
		expect(result?.outputMessages).toMatchSnapshot();
	});

	it("empty maxRoundPercentSteps falls back to default [50, 100]", () => {
		const result = applyAutoCompactPolicy(
			{
				messages: [{ role: "user", content: "go" }],
				outputMessages: Array.from({ length: 4 }, (_, i) =>
					makeFlow(`c${i}`, "x".repeat(200)),
				).flat(),
			},
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
		expect(result?.outputMessages).toMatchSnapshot();
	});
});

// ---------------------------------------------------------------------------
// cache stability: the same cuts request after request, and never the system
// ---------------------------------------------------------------------------

describe("cache-stable compaction", () => {
	const system: ChatCompletionMessageParam = {
		role: "system",
		content: `Rules. Logo: data:image/png;base64,${"A".repeat(400)}`,
	};
	const big = "x".repeat(4_000);
	const flows = (from: number, count: number, content = big) =>
		Array.from({ length: count }, (_, index) =>
			makeFlow(`call_${from + index}`, content),
		).flat();
	const conversation = (
		...extra: ChatCompletionMessageParam[]
	): ChatCompletionMessageParam[] => [
		system,
		{ role: "user", content: "Research it" },
		...flows(0, 10),
		...extra,
	];
	const chunkedIds = (messages: ChatCompletionMessageParam[]) =>
		messages
			.filter(
				(message) =>
					message.role === "tool" &&
					typeof message.content === "string" &&
					message.content.includes("[... chunked tool result:"),
			)
			.map((message) => (message.role === "tool" ? message.tool_call_id : ""));
	/** A window the conversation fills to 80%: past the 75% that compacts. */
	const maxTokens = Math.ceil(estimatePromptTokens(conversation()) / 0.8);

	it("never rewrites the system prompt, even when it holds base64", () => {
		const memory: CompactionMemory = new Map();
		const compacted = applyStickyAutoCompact(
			{ messages: conversation(), outputMessages: [] },
			{ toolResultTrim: disabledTrim, toolCallFlowTrim: disabledTrim },
			Math.ceil(estimatePromptTokens([system]) * 1.1),
			{ memory },
		);
		expect(compacted?.messages[0]).toBe(system);
	});

	it("makes the same cuts again, so the next request starts with the same bytes", () => {
		const memory: CompactionMemory = new Map();
		const first = applyStickyAutoCompact(
			{ messages: conversation(), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory },
		);
		if (!first) throw new Error("expected a compaction");
		expect(chunkedIds(first.messages).length).toBeGreaterThan(0);

		// The next request (or the next message, rebuilt from the full
		// history) has a little more: the earlier cuts are made again and
		// nothing else, so it starts with exactly the bytes sent before.
		const next = applyStickyAutoCompact(
			{ messages: conversation(...flows(10, 1, "ok")), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory },
		);
		expect(next?.messages.slice(0, first.messages.length)).toEqual(
			first.messages,
		);
	});

	it("reports a new compaction once, not each time its cuts are made again", () => {
		const memory: CompactionMemory = new Map();
		const reports: unknown[] = [];
		const onCompacted = (report: unknown) => reports.push(report);
		applyStickyAutoCompact(
			{ messages: conversation(), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory, onCompacted },
		);
		applyStickyAutoCompact(
			{ messages: conversation(...flows(10, 1, "ok")), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory, onCompacted },
		);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			reason: "threshold",
			windowTokens: maxTokens,
			shortened: expect.any(Number),
			removed: expect.any(Number),
		});
		const report = reports[0] as { beforeTokens: number; afterTokens: number };
		expect(report.afterTokens).toBeLessThan(report.beforeTokens);
	});

	it("cuts more only once past the threshold again, keeping the earlier cuts", () => {
		const memory: CompactionMemory = new Map();
		const first = applyStickyAutoCompact(
			{ messages: conversation(), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory },
		);
		const later = applyStickyAutoCompact(
			{ messages: conversation(...flows(10, 6)), outputMessages: [] },
			undefined,
			maxTokens,
			{ memory },
		);
		if (!first || !later) throw new Error("expected compactions");
		// A cut is a result chunked, or its whole call removed.
		const present = (messages: ChatCompletionMessageParam[]) =>
			new Set(
				messages.flatMap((message) =>
					message.role === "tool" ? [message.tool_call_id] : [],
				),
			);
		const cuts = (messages: ChatCompletionMessageParam[], total: number) => {
			const kept = present(messages);
			const chunked = new Set(chunkedIds(messages));
			return Array.from(
				{ length: total },
				(_, index) => `call_${index}`,
			).filter((id) => chunked.has(id) || !kept.has(id));
		};
		const before = cuts(first.messages, 10);
		const after = cuts(later.messages, 16);
		expect(before.length).toBeGreaterThan(0);
		expect(after.length).toBeGreaterThan(before.length);
		for (const id of before) expect(after).toContain(id);
	});
});
