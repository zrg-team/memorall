import { and, eq, gte, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
import {
	MODEL_USAGE_SOURCE_LABELS,
	modelUsageSessionKey,
} from "@/services/model-usage/model-usage-ledger";
import type { UsageMessageRow, UsageRequest } from "../types";
import {
	createFeatureResolver,
	toFeatureEntries,
	type FeatureResolver,
} from "../utils/usage-features";
import { toUsageRequests } from "../utils/usage-records";

/**
 * Every assistant reply with usage since `since`, slimmed in the database: the
 * reply's parts come back as role + tool call ids + result sizes, and tool runs
 * as id + name + source, so long tool outputs never cross the bridge.
 */
export const loadUsageRows = (since: Date): Promise<UsageMessageRow[]> =>
	serviceManager.databaseService.use(({ db, schema }) => {
		const { messages, conversations, flows } = schema;
		return db
			.select({
				id: messages.id,
				conversationId: messages.conversationId,
				createdAt: messages.createdAt,
				conversationTitle: conversations.title,
				flowName: flows.name,
				agentName: sql<string | null>`${messages.metadata}->>'agentFlowName'`,
				model: sql<string | null>`${messages.metadata}->>'model'`,
				provider: sql<string | null>`${messages.metadata}->>'provider'`,
				usage: sql<unknown>`${messages.metadata}->'usage'`,
				toolExecutions: sql<unknown>`(
					select coalesce(jsonb_agg(jsonb_build_object(
						'id', run->>'id',
						'name', run->>'name',
						'source', run->'toolMetadata'->>'source'
					) order by ord), '[]'::jsonb)
					from jsonb_array_elements(
						case when jsonb_typeof(${messages.metadata}->'toolExecutions') = 'array'
						then ${messages.metadata}->'toolExecutions' else '[]'::jsonb end
					) with ordinality as runs(run, ord)
				)`,
				parts: sql<unknown>`(
					select coalesce(jsonb_agg(jsonb_build_object(
						'r', part->>'role',
						'id', part->>'tool_call_id',
						'n', case when part->>'role' = 'tool'
							then length(coalesce(part->>'content', '')) else 0 end,
						'c', case when jsonb_typeof(part->'tool_calls') = 'array' then (
							select jsonb_agg(jsonb_build_object(
								'id', call->>'id',
								'name', call->'function'->>'name'
							))
							from jsonb_array_elements(part->'tool_calls') as calls(call)
						) end
					) order by ord), '[]'::jsonb)
					from jsonb_array_elements(
						case when jsonb_typeof(${messages.parts}) = 'array'
						then ${messages.parts} else '[]'::jsonb end
					) with ordinality as items(part, ord)
				)`,
			})
			.from(messages)
			.innerJoin(conversations, eq(conversations.id, messages.conversationId))
			.leftJoin(flows, eq(flows.id, conversations.agentFlowId))
			.where(
				and(
					eq(messages.role, "assistant"),
					gte(messages.createdAt, since),
					sql`jsonb_typeof(${messages.metadata}->'usage') = 'object'`,
				),
			)
			.orderBy(messages.createdAt);
	});

/**
 * Model requests booked outside chat replies since `since` (pi code and
 * Studio, from its page or an agent's computer), as one-request rows
 * charged to their tool. Each ledger session lists like a conversation; one
 * that belongs to no agent is named after its source ("Studio").
 */
export const loadModelUsageRows = (since: Date): Promise<UsageMessageRow[]> =>
	serviceManager.databaseService.use(async ({ db, schema }) => {
		const { modelUsage, flows } = schema;
		const rows = await db
			.select({
				id: modelUsage.id,
				source: modelUsage.source,
				tool: modelUsage.tool,
				sessionId: modelUsage.sessionId,
				title: modelUsage.title,
				provider: modelUsage.provider,
				model: modelUsage.model,
				usage: modelUsage.usage,
				createdAt: modelUsage.createdAt,
				flowName: flows.name,
			})
			.from(modelUsage)
			.leftJoin(flows, eq(flows.id, modelUsage.agentFlowId))
			.where(gte(modelUsage.createdAt, since))
			.orderBy(modelUsage.createdAt);
		return rows.map(
			(row): UsageMessageRow => ({
				id: row.id,
				conversationId: modelUsageSessionKey(row),
				createdAt: row.createdAt,
				conversationTitle: row.title,
				flowName: row.flowName,
				agentName: row.flowName
					? null
					: (MODEL_USAGE_SOURCE_LABELS[row.source] ?? null),
				model: row.model,
				provider: row.provider,
				usage: row.usage,
				toolExecutions: [],
				parts: [],
				charge: { tool: row.tool || row.source, source: row.source },
			}),
		);
	});

const toCost = (value: number | string | null | undefined): number => {
	const cost = typeof value === "string" ? Number(value) : (value ?? 0);
	return Number.isFinite(cost) ? cost : 0;
};

/**
 * Provider-reported spend since `since`, chat replies and the model usage
 * ledger together, summed in the database.
 */
export const loadReportedSpend = async (since: Date): Promise<number> => {
	const [replies, ledger] = await serviceManager.databaseService.use(
		({ db, schema }) =>
			Promise.all([
				db
					.select({
						cost: sql<
							number | string | null
						>`sum(case when jsonb_typeof(${schema.messages.metadata}->'usage'->'cost') = 'number' then (${schema.messages.metadata}->'usage'->>'cost')::float8 end)`,
					})
					.from(schema.messages)
					.where(
						and(
							eq(schema.messages.role, "assistant"),
							gte(schema.messages.createdAt, since),
						),
					),
				db
					.select({
						cost: sql<
							number | string | null
						>`sum(case when jsonb_typeof(${schema.modelUsage.usage}->'cost') = 'number' then (${schema.modelUsage.usage}->>'cost')::float8 end)`,
					})
					.from(schema.modelUsage)
					.where(gte(schema.modelUsage.createdAt, since)),
			]),
	);
	return toCost(replies[0]?.cost) + toCost(ledger[0]?.cost);
};

const loadFeatureResolver = (): FeatureResolver => {
	try {
		const { steps } = serviceManager.flowBuilderService.getCatalog();
		return createFeatureResolver(toFeatureEntries(steps));
	} catch {
		return createFeatureResolver([]);
	}
};

export const loadUsageRequests = async (
	since: Date,
): Promise<UsageRequest[]> => {
	const [replies, ledger] = await Promise.all([
		loadUsageRows(since),
		loadModelUsageRows(since),
	]);
	const rows = [...replies, ...ledger];
	const resolveFeature = loadFeatureResolver();
	return rows.flatMap((row) => toUsageRequests(row, resolveFeature));
};

/** Feature names from the flow catalog, keyed like the resolver's output. */
export const loadFeatureLabels = (): Map<string, string> => {
	try {
		const { steps } = serviceManager.flowBuilderService.getCatalog();
		return new Map(
			toFeatureEntries(steps).map((entry) => [entry.key, entry.label]),
		);
	} catch {
		return new Map();
	}
};
