import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/services/database/migrations";
import { schema } from "@/services/database/schema";

const database = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: async (fn: (context: { db: unknown; schema: unknown }) => unknown) =>
				fn({ db: database.db, schema }),
		},
		flowBuilderService: {
			getCatalog: () => ({
				services: [],
				steps: [
					{
						id: "step-web",
						name: "web",
						type: "feature",
						metadata: {
							displayName: "Web Browser",
							tools: ["web_search", "web_read"],
						},
					},
					{
						id: "step-fs",
						name: "fs",
						type: "feature",
						metadata: { displayName: "File System", tools: ["fs_read"] },
					},
				],
			}),
		},
	},
}));

import {
	loadFeatureLabels,
	loadReportedSpend,
	loadUsageRequests,
} from "../usage-repository";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const toolCall = (id: string, name: string) => ({
	id,
	type: "function",
	function: { name, arguments: "{}" },
});

describe("usage repository", () => {
	let pg: PGlite;

	beforeAll(async () => {
		pg = new PGlite({ extensions: { vector, uuid_ossp, pg_trgm } });
		await pg.waitReady;
		await runMigrations(pg);
		database.db = drizzle(pg, { schema });
	}, 60_000);

	afterAll(async () => {
		await pg.close();
	});

	it("reads each reply's requests with the tool results they read", async () => {
		const db = database.db as Db;
		const [flow] = await db
			.insert(schema.flows)
			.values({ name: "Research Scout" })
			.returning();
		const [chat, scheduled] = await db
			.insert(schema.conversations)
			.values([
				{ title: "Compare lease offers" },
				{ title: "Scout Schedule", agentFlowId: flow?.id },
			])
			.returning();
		if (!chat || !scheduled) throw new Error("no conversations");
		const now = new Date();
		const old = new Date(now.getTime() - 40 * 86_400_000);

		await db.insert(schema.messages).values([
			{
				conversationId: chat.id,
				role: "assistant",
				content: "final",
				createdAt: now,
				parts: [
					{
						role: "assistant",
						content: "",
						tool_calls: [toolCall("call_1", "web_search")],
					},
					{ role: "tool", tool_call_id: "call_1", content: "x".repeat(400) },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							toolCall("call_2", "web_read"),
							toolCall("call_3", "fs_read"),
						],
					},
					{ role: "tool", tool_call_id: "call_2", content: "y".repeat(300) },
					{ role: "tool", tool_call_id: "call_3", content: "z".repeat(100) },
					{ role: "assistant", content: "final" },
				],
				metadata: {
					model: "anthropic/claude-sonnet-4.5",
					provider: "openrouter",
					agentFlowName: "CoAgent",
					toolExecutions: [
						{ id: "call_1", name: "web_search", status: "completed" },
						{ id: "call_2", name: "web_read", status: "completed" },
						{ id: "call_3", name: "fs_read", status: "completed" },
					],
					usage: {
						prompt_tokens: 600,
						completion_tokens: 60,
						total_tokens: 660,
						cost: 0.06,
						requests: 3,
						calls: [
							{ prompt_tokens: 100, completion_tokens: 20, cost: 0.01 },
							{ prompt_tokens: 200, completion_tokens: 20, cost: 0.02 },
							{
								prompt_tokens: 300,
								cached_tokens: 150,
								completion_tokens: 20,
								reasoning_tokens: 5,
								cost: 0.03,
							},
						],
					},
				},
			},
			{
				conversationId: scheduled.id,
				role: "assistant",
				content: "briefing",
				createdAt: now,
				metadata: {
					source: "cron",
					model: "qwen2.5-7b-instruct.gguf",
					provider: "wllama",
					usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
				},
			},
			{
				conversationId: chat.id,
				role: "assistant",
				content: "too old",
				createdAt: old,
				metadata: {
					usage: { prompt_tokens: 1, completion_tokens: 1, cost: 5 },
				},
			},
			{
				conversationId: chat.id,
				role: "user",
				content: "question",
				createdAt: now,
				metadata: { usage: { prompt_tokens: 9, completion_tokens: 9 } },
			},
			{
				conversationId: chat.id,
				role: "assistant",
				content: "checkpoint",
				createdAt: now,
				metadata: { incomplete: true },
			},
		]);

		const since = new Date(now.getTime() - 7 * 86_400_000);
		const requests = await loadUsageRequests(since);

		expect(requests).toHaveLength(4);
		const [first, second, third, cron] = requests;
		expect(first).toMatchObject({
			conversationTitle: "Compare lease offers",
			agent: "CoAgent",
			model: "anthropic/claude-sonnet-4.5",
			provider: "openrouter",
			local: false,
			cost: 0.01,
			inputTokens: 100,
			tools: [],
		});
		expect(second?.tools).toEqual([
			{
				tool: "web_search",
				feature: "step-web",
				weight: 1,
				resultChars: 400,
				calls: 1,
			},
		]);
		expect(third).toMatchObject({ cachedTokens: 150, reasoningTokens: 5 });
		expect(
			third?.tools.map((share) => [share.tool, share.feature, share.weight]),
		).toEqual([
			["web_read", "step-web", 0.75],
			["fs_read", "step-fs", 0.25],
		]);
		expect(cron).toMatchObject({
			agent: "Research Scout",
			local: true,
			cost: 0,
			inputTokens: 50,
			tools: [],
		});
		expect(first?.at).toBeGreaterThan(since.getTime());

		await expect(loadReportedSpend(since)).resolves.toBeCloseTo(0.06);
		expect(loadFeatureLabels().get("step-fs")).toBe("File System");
	});

	it("adds the model usage ledger: requests made on a computer, charged to their tool", async () => {
		const db = database.db as Db;
		const since = new Date(Date.now() - 86_400_000);
		const spentBefore = await loadReportedSpend(since);
		const [agent] = await db
			.insert(schema.flows)
			.values({ name: "Coder" })
			.returning();
		await db.insert(schema.modelUsage).values([
			{
				source: "pi-code",
				tool: "web_read",
				agentFlowId: agent?.id,
				sessionId: "pi-1",
				title: "pi code · ~/todo",
				provider: "openrouter",
				model: "anthropic/claude-sonnet-4.5",
				usage: {
					prompt_tokens: 900,
					completion_tokens: 60,
					total_tokens: 960,
					cached_tokens: 800,
					cost: 0.004,
				},
			},
			{
				// A run on the Studio page: no agent, charged to its studio.
				source: "studio",
				tool: "decision",
				sessionId: "studio-session-1",
				title: "Support tickets",
				provider: "ollama",
				model: "llama-4",
				usage: {
					prompt_tokens: 40,
					completion_tokens: 4,
					total_tokens: 44,
					estimated: true,
				},
			},
		]);

		const ledger = (await loadUsageRequests(since)).filter((request) =>
			request.conversationId.startsWith("model-usage:"),
		);
		expect(ledger).toEqual([
			expect.objectContaining({
				conversationId: "model-usage:pi-code:pi-1",
				conversationTitle: "pi code · ~/todo",
				agent: "Coder",
				provider: "openrouter",
				local: false,
				cost: 0.004,
				inputTokens: 900,
				cachedTokens: 800,
				outputTokens: 60,
				// Charged to its tool as a whole, without a call of its own.
				tools: [
					{
						tool: "web_read",
						feature: "step-web",
						weight: 1,
						resultChars: 0,
						calls: 0,
					},
				],
			}),
			expect.objectContaining({
				conversationId: "model-usage:studio:studio-session-1",
				conversationTitle: "Support tickets",
				// Named after its source, not "Default chat".
				agent: "Studio",
				local: true,
				cost: 0,
				estimated: true,
				// Studio's own feature; each run is a call of its studio.
				tools: [
					{
						tool: "decision",
						feature: "source:studio",
						weight: 1,
						resultChars: 0,
						calls: 1,
					},
				],
			}),
		]);
		await expect(loadReportedSpend(since)).resolves.toBeCloseTo(
			spentBefore + 0.004,
		);
	});
});
