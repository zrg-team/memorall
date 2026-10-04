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

	it("formats a chat's cost and tokens at a glance", () => {
		expect(formatUsd(0.0926)).toBe("$0.093");
		expect(formatUsd(1.234)).toBe("$1.23");
		expect(formatUsd(0.0057)).toBe("$0.0057");
		expect(formatUsd(0)).toBe("$0");
		expect(formatTokenCount(1_704_188)).toBe("1.7M");
		expect(formatTokenCount(76_400)).toBe("76k");
		expect(formatTokenCount(640)).toBe("640");
	});
});
