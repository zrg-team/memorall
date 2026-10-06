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
	},
}));

import {
	cachedPercent,
	formatTokenCount,
	formatUsd,
	withRunUsage,
} from "../conversation-cost-format";
import { loadConversationCosts } from "../conversation-costs";

describe("a chat's cost", () => {
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

	it("adds up every reply's usage in the database, per chat", async () => {
		const db = database.db as ReturnType<typeof drizzle<typeof schema>>;
		const [paid, local, empty] = await db
			.insert(schema.conversations)
			.values([{ title: "Paid" }, { title: "Local" }, { title: "Empty" }])
			.returning();
		if (!paid || !local || !empty) throw new Error("no conversations");
		const reply = (
			conversationId: string,
			metadata: Record<string, unknown>,
		) => ({
			conversationId,
			type: "text",
			role: "assistant",
			content: "answer",
			metadata,
		});
		await db.insert(schema.messages).values([
			reply(paid.id, {
				usage: {
					prompt_tokens: 1_044_025,
					cached_tokens: 899_776,
					completion_tokens: 17_495,
					cost: 0.0574,
					requests: 33,
				},
			}),
			reply(paid.id, {
				usage: {
					prompt_tokens: 660_163,
					cached_tokens: 511_104,
					completion_tokens: 1_272,
					cost: 0.0352,
					requests: 9,
				},
			}),
			// A reply saved before usage was kept, and the user's own messages.
			reply(paid.id, { model: "old" }),
			{ ...reply(paid.id, { usage: { cost: 99 } }), role: "user" },
			// A local model reports tokens but no price.
			reply(local.id, {
				usage: { prompt_tokens: 5_000, completion_tokens: 200 },
			}),
		]);

		const costs = await loadConversationCosts([paid.id, local.id, empty.id]);

		expect(costs[paid.id]).toEqual({
			cost: expect.closeTo(0.0926, 6),
			inputTokens: 1_704_188,
			cachedTokens: 1_410_880,
			outputTokens: 18_767,
			requests: 42,
			replies: 2,
		});
		expect(costs[local.id]).toEqual({
			inputTokens: 5_000,
			cachedTokens: 0,
			outputTokens: 200,
			requests: 1,
			replies: 1,
		});
		expect(costs[empty.id]).toBeUndefined();
		expect(await loadConversationCosts([])).toEqual({});
		expect(cachedPercent(costs[paid.id]!)).toBe(83);
	});

	it("counts what pi code spent on a chat's task in that chat's cost", async () => {
		const db = database.db as ReturnType<typeof drizzle<typeof schema>>;
		const [coding, piOnly, other] = await db
			.insert(schema.conversations)
			.values([{ title: "Coding" }, { title: "pi only" }, { title: "Other" }])
			.returning();
		if (!coding || !piOnly || !other) throw new Error("no conversations");
		await db.insert(schema.messages).values({
			conversationId: coding.id,
			type: "text",
			role: "assistant",
			content: "pi built it",
			metadata: {
				usage: {
					prompt_tokens: 40_000,
					cached_tokens: 30_000,
					completion_tokens: 900,
					cost: 0.09,
					requests: 6,
				},
			},
		});
		const piRequest = (
			conversationId: string | null,
			usage: Record<string, number>,
		) => ({
			source: "pi-code",
			tool: "memon_code",
			conversationId,
			sessionId: "pi-session",
			title: "pi code · ~/game",
			provider: "openrouter",
			model: "deepseek",
			usage,
		});
		await db.insert(schema.modelUsage).values([
			piRequest(coding.id, {
				prompt_tokens: 1_000_000,
				cached_tokens: 900_000,
				completion_tokens: 20_000,
				cost: 0.6,
			}),
			piRequest(coding.id, {
				prompt_tokens: 500_000,
				completion_tokens: 10_000,
				cost: 0.4,
			}),
			piRequest(piOnly.id, { prompt_tokens: 100, completion_tokens: 10 }),
			// The user typing to pi: no chat asked for it.
			piRequest(null, { prompt_tokens: 9_999, completion_tokens: 9, cost: 5 }),
		]);

		const costs = await loadConversationCosts([coding.id, piOnly.id, other.id]);

		expect(costs[coding.id]).toEqual({
			cost: expect.closeTo(1.09, 6),
			inputTokens: 1_540_000,
			cachedTokens: 930_000,
			outputTokens: 30_900,
			requests: 8,
			replies: 1,
			tools: { cost: expect.closeTo(1, 6), requests: 2 },
		});
		expect(costs[piOnly.id]).toEqual({
			inputTokens: 100,
			cachedTokens: 0,
			outputTokens: 10,
			requests: 1,
			replies: 0,
			tools: { requests: 1 },
		});
		expect(costs[other.id]).toBeUndefined();
		// A running reply keeps the tools' share on top.
		expect(
			withRunUsage(costs[coding.id], {
				prompt_tokens: 1,
				completion_tokens: 1,
				total_tokens: 2,
				requests: 1,
			}),
		).toMatchObject({ tools: { requests: 2 } });
	});

	it("formats a chat's cost and tokens at a glance", () => {
		expect(formatUsd(0.0926)).toBe("$0.093");
		expect(formatUsd(1.234)).toBe("$1.23");
		expect(formatUsd(0.0057)).toBe("$0.0057");
		expect(formatUsd(0)).toBe("$0");
		expect(formatTokenCount(1_704_188)).toBe("1.7M");
		expect(formatTokenCount(76_400)).toBe("76k");
		expect(formatTokenCount(640)).toBe("640");
	});

	it("adds a running reply on top of what the chat had", () => {
		const saved = {
			cost: 0.02,
			inputTokens: 10_000,
			cachedTokens: 8_000,
			outputTokens: 300,
			requests: 5,
			replies: 1,
		};
		const running = {
			prompt_tokens: 6_000,
			completion_tokens: 100,
			total_tokens: 6_100,
			cached_tokens: 5_000,
			cost: 0.004,
			requests: 2,
		};

		expect(withRunUsage(saved, running)).toEqual({
			cost: expect.closeTo(0.024, 6),
			inputTokens: 16_000,
			cachedTokens: 13_000,
			outputTokens: 400,
			requests: 7,
			replies: 2,
		});
		// The first reply of a new chat has nothing saved under it yet.
		expect(withRunUsage(undefined, running)).toMatchObject({
			cost: 0.004,
			replies: 1,
		});
		// A model that reports no price stays a token count.
		const { cost: _cost, ...unpriced } = running;
		expect(withRunUsage(undefined, unpriced)).not.toHaveProperty("cost");
		// Nothing running: the saved total as it is.
		expect(withRunUsage(saved, undefined)).toBe(saved);
	});
});
