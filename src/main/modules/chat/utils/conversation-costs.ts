import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { ConversationCost } from "./conversation-cost-format";

export type { ConversationCost } from "./conversation-cost-format";

type UsageField =
	| "cost"
	| "prompt_tokens"
	| "cached_tokens"
	| "completion_tokens";

/**
 * One of usage's numbers, summed; rows without it count as nothing. `usage`
 * is where a row keeps it: a reply's message metadata, or a ledger row.
 */
const usageSum = (usage: SQL, field: UsageField) => {
	// A fixed key, inlined: a bound parameter after -> is ambiguous to Postgres.
	const key = sql.raw(`'${field}'`);
	return sql<
		number | null
	>`sum(case when jsonb_typeof(${usage}->${key}) = 'number' then (${usage}->>${key})::float8 end)`;
};

const usageNumber = (field: UsageField) =>
	usageSum(sql.raw("metadata->'usage'"), field);
const ledgerNumber = (field: UsageField) => usageSum(sql.raw("usage"), field);

const toNumber = (value: unknown): number =>
	typeof value === "number"
		? value
		: typeof value === "string" && value.trim()
			? Number(value)
			: 0;

/**
 * The cost of each of these chats, added up in the database from what every
 * reply saved, so a long chat costs one row to read, not all its messages.
 * Requests its tools made for it outside the replies (pi code working on
 * what the chat's agent handed it) are in the ledger, and count too.
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
	const booked = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({
				conversationId: schema.modelUsage.conversationId,
				cost: ledgerNumber("cost"),
				inputTokens: ledgerNumber("prompt_tokens"),
				cachedTokens: ledgerNumber("cached_tokens"),
				outputTokens: ledgerNumber("completion_tokens"),
				requests: sql<number | null>`count(*)`,
				priced: sql<
					number | null
				>`count(*) filter (where jsonb_typeof(usage->'cost') = 'number')`,
			})
			.from(schema.modelUsage)
			.where(inArray(schema.modelUsage.conversationId, [...conversationIds]))
			.groupBy(schema.modelUsage.conversationId),
	);
	for (const row of booked) {
		if (!row.conversationId) continue;
		const tools = {
			...(toNumber(row.priced) > 0 ? { cost: toNumber(row.cost) } : {}),
			requests: toNumber(row.requests),
		};
		const replies = costs[row.conversationId];
		const priced = replies?.cost !== undefined || tools.cost !== undefined;
		costs[row.conversationId] = {
			...(priced ? { cost: (replies?.cost ?? 0) + (tools.cost ?? 0) } : {}),
			inputTokens: (replies?.inputTokens ?? 0) + toNumber(row.inputTokens),
			cachedTokens: (replies?.cachedTokens ?? 0) + toNumber(row.cachedTokens),
			outputTokens: (replies?.outputTokens ?? 0) + toNumber(row.outputTokens),
			requests: (replies?.requests ?? 0) + tools.requests,
			replies: replies?.replies ?? 0,
			tools,
		};
	}
	return costs;
};
