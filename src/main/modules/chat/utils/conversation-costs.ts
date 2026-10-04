import { and, eq, inArray, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { ConversationCost } from "./conversation-cost-format";

export type { ConversationCost } from "./conversation-cost-format";

/** One of usage's numbers, summed; replies without it count as nothing. */
const usageNumber = (
	field: "cost" | "prompt_tokens" | "cached_tokens" | "completion_tokens",
) => {
	// A fixed key, inlined: a bound parameter after -> is ambiguous to Postgres.
	const key = sql.raw(`'${field}'`);
	return sql<
		number | null
	>`sum(case when jsonb_typeof(metadata->'usage'->${key}) = 'number' then (metadata->'usage'->>${key})::float8 end)`;
};

const toNumber = (value: unknown): number =>
	typeof value === "number"
		? value
		: typeof value === "string" && value.trim()
			? Number(value)
			: 0;

/**
 * The cost of each of these chats, added up in the database from what every
 * reply saved, so a long chat costs one row to read, not all its messages.
 */
export const loadConversationCosts = async (
	conversationIds: readonly string[],
): Promise<Record<string, ConversationCost>> => {
	if (!conversationIds.length) return {};
	const rows = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({
				conversationId: schema.messages.conversationId,
				cost: usageNumber("cost"),
				inputTokens: usageNumber("prompt_tokens"),
				cachedTokens: usageNumber("cached_tokens"),
				outputTokens: usageNumber("completion_tokens"),
				requests: sql<
					number | null
				>`sum(case when jsonb_typeof(metadata->'usage'->'requests') = 'number' then (metadata->'usage'->>'requests')::float8 when jsonb_typeof(metadata->'usage') = 'object' then 1 end)`,
				replies: sql<
					number | null
				>`count(*) filter (where jsonb_typeof(metadata->'usage') = 'object')`,
				priced: sql<
					number | null
				>`count(*) filter (where jsonb_typeof(metadata->'usage'->'cost') = 'number')`,
			})
			.from(schema.messages)
			.where(
				and(
					inArray(schema.messages.conversationId, [...conversationIds]),
					eq(schema.messages.role, "assistant"),
				),
			)
			.groupBy(schema.messages.conversationId),
	);
	const costs: Record<string, ConversationCost> = {};
	for (const row of rows) {
		if (!row.conversationId || toNumber(row.replies) === 0) continue;
		costs[row.conversationId] = {
			...(toNumber(row.priced) > 0 ? { cost: toNumber(row.cost) } : {}),
			inputTokens: toNumber(row.inputTokens),
			cachedTokens: toNumber(row.cachedTokens),
			outputTokens: toNumber(row.outputTokens),
			requests: toNumber(row.requests),
			replies: toNumber(row.replies),
		};
	}
	return costs;
};
