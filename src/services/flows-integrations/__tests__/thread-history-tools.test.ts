import { createFlowRuntimeVars } from "@memorall/agent-harness-flows/context/runtime-context";
import { describe, expect, it, vi } from "vitest";
import {
	createThreadHistoryReadTool,
	createThreadHistorySearchTool,
	scoreThreadHistoryMatch,
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
	type ThreadHistoryCorpusStats,
	tokenizeSearchQuery,
} from "@/services/flows-integrations/tools/thread-history";

const context = () => ({
	state: {},
	runtime: createFlowRuntimeVars({
		[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: "conversation-1",
		[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]: "separator-1",
	}),
});

const row = (overrides: Record<string, unknown> = {}) => ({
	messageId: "message-1",
	role: "assistant",
	content: "alpha\nbefore\nmatched phrase\nafter\nomega",
	parts: null,
	complexContent: null,
	metadata: {},
	createdAt: "2026-08-12T00:00:00.000Z",
	...overrides,
});

/**
 * Search issues two statements — candidates, then corpus statistics — so the
 * mock has to answer by shape rather than by call order.
 */
const searchDatabase = (
	candidates: ReturnType<typeof row>[],
	stats: Record<string, unknown> = {},
) => {
	const raw = vi.fn(async (sql: string) => {
		if (sql.includes('AS "totalDocs"')) {
			return [{ totalDocs: 10, averageLength: 40, df0: 1, df1: 1, ...stats }];
		}
		return candidates;
	});
	return { raw };
};

describe("thread history search", () => {
	it("returns matched message IDs with line-based prefix and suffix context", async () => {
		const database = searchDatabase([row()]);
		const tool = createThreadHistorySearchTool({ database } as never);
		const result = await tool.execute(
			{ query: "matched phrase", prefixLines: 1, suffixLines: 1 },
			context(),
		);

		expect(result).not.toMatchObject({ isError: true });
		const content = (result as { content: string }).content;
		expect(content).toContain("messageId: message-1");
		expect(content).toContain("L3> matched phrase");
		expect(content).toContain("L2| before");
		expect(content).toContain("L4| after");
		expect(database.raw).toHaveBeenCalledWith(
			expect.stringContaining("m.created_at < boundary.created_at"),
			["conversation-1", "separator-1", "matched phrase", 64],
		);
	});

	it("collects corpus statistics for every query term", async () => {
		const database = searchDatabase([row()]);
		const tool = createThreadHistorySearchTool({ database } as never);
		await tool.execute({ query: "matched phrase" }, context());

		expect(database.raw).toHaveBeenCalledWith(
			expect.stringContaining('AS "totalDocs"'),
			["conversation-1", "separator-1", "%matched%", "%phrase%"],
		);
	});

	it("reorders candidates so the tighter match comes first", async () => {
		// The SQL hands these back newest-first; ranking has to override that.
		const noisy = row({
			messageId: "noisy",
			content: `notes\nrollback happened and the token was fine${" padding".repeat(200)}`,
		});
		const focused = row({
			messageId: "focused",
			content: "notes\nrollback token rotated",
		});
		const database = searchDatabase([noisy, focused], {
			totalDocs: 100,
			averageLength: 60,
			df0: 4, // rollback
			df1: 6, // token
		});
		const tool = createThreadHistorySearchTool({ database } as never);
		const result = await tool.execute({ query: "rollback token" }, context());
		const content = (result as { content: string }).content;

		expect(content.indexOf("messageId: focused")).toBeLessThan(
			content.indexOf("messageId: noisy"),
		);
	});

	it("skips the statistics query when nothing matched", async () => {
		const database = searchDatabase([]);
		const tool = createThreadHistorySearchTool({ database } as never);
		const result = await tool.execute({ query: "nothing" }, context());

		expect((result as { content: string }).content).toContain(
			'No earlier messages matched "nothing"',
		);
		expect(database.raw).toHaveBeenCalledTimes(1);
	});

	it("rejects execution without trusted thread scope", async () => {
		const tool = createThreadHistorySearchTool({
			database: { raw: vi.fn() },
		} as never);
		const result = await tool.execute({ query: "anything" }, { state: {} });
		expect(result).toMatchObject({ isError: true });
		expect((result as { content: string }).content).toContain(
			"Earlier thread history is not available",
		);
	});
});

describe("thread history BM25 scoring", () => {
	const stats = (
		documentFrequency: Record<string, number>,
		overrides: Partial<ThreadHistoryCorpusStats> = {},
	): ThreadHistoryCorpusStats => ({
		totalDocs: 100,
		averageLength: 50,
		documentFrequency,
		...overrides,
	});

	it("scores a rare term above a common one at equal frequency", () => {
		const corpus = stats({ rare: 1, common: 95 });
		const rare = scoreThreadHistoryMatch("rare", ["rare"], "rare", corpus);
		const common = scoreThreadHistoryMatch(
			"common",
			["common"],
			"common",
			corpus,
		);
		expect(rare).toBeGreaterThan(common);
	});

	it("penalises length: the same hit scores lower in a longer document", () => {
		const corpus = stats({ token: 5 });
		const short = scoreThreadHistoryMatch("token", ["token"], "token", corpus);
		const long = scoreThreadHistoryMatch(
			`token${" filler".repeat(200)}`,
			["token"],
			"token",
			corpus,
		);
		expect(long).toBeLessThan(short);
	});

	it("rewards an exact phrase over scattered terms", () => {
		const corpus = stats({ rollback: 4, token: 6 });
		const terms = ["rollback", "token"];
		const phrase = scoreThreadHistoryMatch(
			"the rollback token was rotated",
			terms,
			"rollback token",
			corpus,
		);
		const scattered = scoreThreadHistoryMatch(
			"the rollback was fine and the token was rotated",
			terms,
			"rollback token",
			corpus,
		);
		expect(phrase).toBeGreaterThan(scattered);
	});

	it("gives a term present in every document almost no weight", () => {
		const corpus = stats({ the: 100 });
		expect(
			scoreThreadHistoryMatch("the the the", ["the"], "the", corpus),
		).toBeLessThan(0.02);
	});

	it("returns zero when the corpus is empty", () => {
		expect(
			scoreThreadHistoryMatch("anything", ["anything"], "anything", {
				totalDocs: 0,
				averageLength: 0,
				documentFrequency: {},
			}),
		).toBe(0);
	});

	it("tokenises to distinct, punctuation-trimmed terms", () => {
		expect(tokenizeSearchQuery("Deploy, deploy the ROLLBACK.")).toEqual([
			"deploy",
			"the",
			"rollback",
		]);
		expect(tokenizeSearchQuery("a b c d e", 3)).toHaveLength(3);
	});
});

describe("thread history read", () => {
	it("reads the same inclusive line range from multiple IDs in requested order", async () => {
		const raw = vi
			.fn()
			.mockResolvedValue([
				row({ messageId: "message-2", content: "two-a\ntwo-b\ntwo-c" }),
				row({ messageId: "message-1", content: "one-a\none-b\none-c" }),
			]);
		const tool = createThreadHistoryReadTool({ database: { raw } } as never);
		const result = await tool.execute(
			{
				messageIds: ["message-1", "message-2"],
				fromLine: 2,
				toLine: 3,
			},
			context(),
		);
		const content = (result as { content: string }).content;

		expect(content.indexOf("messageId: message-1")).toBeLessThan(
			content.indexOf("messageId: message-2"),
		);
		expect(content).toContain("L2| one-b");
		expect(content).toContain("L3| one-c");
		expect(content).not.toContain("one-a");
		expect(content).toContain("L2| two-b");
	});

	const toolCallRow = () =>
		row({
			content: "",
			parts: [
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call-1",
							type: "function",
							function: {
								name: "web_search",
								arguments: '{"query":"rollback token"}',
							},
						},
					],
				},
				{
					role: "tool",
					tool_call_id: "call-1",
					content: "a very long tool payload",
				},
			],
		});

	it("collapses tool calls and results in compact mode", async () => {
		const raw = vi.fn().mockResolvedValue([toolCallRow()]);
		const tool = createThreadHistoryReadTool({ database: { raw } } as never);
		const result = await tool.execute(
			{ messageIds: ["message-1"], fromLine: 1, toLine: 20 },
			context(),
		);
		const content = (result as { content: string }).content;

		expect(content).toContain("· compact ·");
		expect(content).toContain("[tool_call: web_search]");
		expect(content).toContain("[tool_result: web_search · 24 chars]");
		expect(content).not.toContain("a very long tool payload");
		expect(content).not.toContain("rollback token");
	});

	it("renders tool arguments and payloads in detail mode", async () => {
		const raw = vi.fn().mockResolvedValue([toolCallRow()]);
		const tool = createThreadHistoryReadTool({ database: { raw } } as never);
		const result = await tool.execute(
			{ messageIds: ["message-1"], fromLine: 1, toLine: 20, mode: "detail" },
			context(),
		);
		const content = (result as { content: string }).content;

		expect(content).toContain("· detail ·");
		expect(content).toContain(
			'[tool_call: web_search] {"query":"rollback token"}',
		);
		expect(content).toContain("a very long tool payload");
	});

	it("caps the requested range instead of reading a whole message", async () => {
		const lines = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`);
		const raw = vi.fn().mockResolvedValue([row({ content: lines.join("\n") })]);
		const tool = createThreadHistoryReadTool({ database: { raw } } as never);
		const result = await tool.execute(
			{ messageIds: ["message-1"], fromLine: 1, toLine: 500 },
			context(),
		);
		const content = (result as { content: string }).content;

		expect(content).toContain("lines 1-200/500");
		expect(content).toContain("L200| line-200");
		expect(content).not.toContain("L201| line-201");
	});

	it("rejects an inverted range", async () => {
		const tool = createThreadHistoryReadTool({
			database: { raw: vi.fn() },
		} as never);
		const result = await tool.execute(
			{ messageIds: ["message-1"], fromLine: 9, toLine: 2 },
			context(),
		);
		expect(result).toMatchObject({ isError: true });
	});
});
