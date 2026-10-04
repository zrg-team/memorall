import { and, eq, gte, sql } from "drizzle-orm";
import { serviceManager } from "@/services";
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

/** Provider-reported spend since `since`, summed in the database. */
export const loadReportedSpend = async (since: Date): Promise<number> => {
	const rows = await serviceManager.databaseService.use(({ db, schema }) =>
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
	);
	const cost = rows[0]?.cost;
	const value = typeof cost === "string" ? Number(cost) : (cost ?? 0);
	return Number.isFinite(value) ? value : 0;
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
	const rows = await loadUsageRows(since);
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
