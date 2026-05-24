import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type {
	StructMemEntry,
	StructMemEvent,
	StructMemState,
} from "../../graph/structmem/state";
import { getCurrentEmbeddingColumns } from "../../utils/embedding-size-config";
import {
	dedupeEntries,
	groupEntriesByEvent,
	nodeRowToStructMemEntry,
	type StructMemNodeRow,
} from "./structmem-utils";
import { logError, logInfo, logWarn } from "../../interfaces/logger";

const STEP_NAME = "structmem-load-related-events" as const;

export interface StructMemLoadRelatedEventsInput {
	graphId?: string;
	bufferedEntries: StructMemEntry[];
}

export interface StructMemLoadRelatedEventsOutput {
	relatedEntries?: StructMemEntry[];
	reconstructedEvents?: StructMemEvent[];
	processingStage?: StructMemState["processingStage"];
	errors?: string[];
}

export interface StructMemLoadRelatedEventsConfig {
	semanticSeedLimit?: number;
}

type StructMemLoadRelatedEventsServices = Pick<
	AllServices,
	"database" | "embedding"
>;

function buildReconstructedEvents(entries: StructMemEntry[]): StructMemEvent[] {
	return Array.from(groupEntriesByEvent(entries).entries())
		.map(([eventId, eventEntries]) => ({
			eventId,
			timestamp: eventEntries[0]?.timestamp ?? new Date().toISOString(),
			entries: eventEntries.sort(
				(a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
			),
		}))
		.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

async function loadSeedEntries(
	services: StructMemLoadRelatedEventsServices,
	graphId: string,
	queryText: string,
	limit: number,
	excludedNodeIds: Set<string>,
): Promise<StructMemEntry[]> {
	const embedding = await services.embedding.get("default");
	if (!embedding?.isReady()) {
		logWarn("[STRUCTMEM_LOAD_RELATED] Embedding service unavailable");
		return [];
	}

	const queryEmbedding = await embedding.textToVector(queryText);
	const columns = await getCurrentEmbeddingColumns();
	const excluded = Array.from(excludedNodeIds);
	const params: (string | number)[] = [JSON.stringify(queryEmbedding), graphId];

	let excludeClause = "";
	if (excluded.length > 0) {
		const placeholders = excluded.map((id) => {
			params.push(id);
			return `$${params.length}`;
		});
		excludeClause = ` AND id NOT IN (${placeholders.join(", ")})`;
	}

	params.push(limit);
	const rows = await getKnowledgeDatabase(services.database).query(
		async ({ raw }) => {
			const queryResult = await raw(
				`SELECT id, node_type, name, summary, attributes, graph, created_at, updated_at,
			        1 - (${columns.nameEmbedding} <=> $1::vector) AS similarity
			 FROM nodes
			 WHERE node_type IN ('structmem_entry', 'structmem_factual_entry', 'structmem_relational_entry')
			   AND graph = $2
			   AND attributes->>'structmem' = 'true'
			   AND ${columns.nameEmbedding} IS NOT NULL
			   ${excludeClause}
			 ORDER BY similarity DESC
			 LIMIT $${params.length}`,
				params,
			);
			return ((queryResult as { rows?: StructMemNodeRow[] }).rows ??
				[]) as StructMemNodeRow[];
		},
	);

	return dedupeEntries(rows.map(nodeRowToStructMemEntry));
}

async function reconstructEventsByIds(
	services: StructMemLoadRelatedEventsServices,
	graphId: string,
	eventIds: string[],
): Promise<StructMemEntry[]> {
	if (eventIds.length === 0) return [];

	const params: string[] = [graphId];
	const placeholders = eventIds.map((eventId) => {
		params.push(eventId);
		return `$${params.length}`;
	});

	const rows = await getKnowledgeDatabase(services.database).query(
		async ({ raw }) => {
			const queryResult = await raw(
				`SELECT id, node_type, name, summary, attributes, graph, created_at, updated_at
			 FROM nodes
			 WHERE node_type IN ('structmem_entry', 'structmem_factual_entry', 'structmem_relational_entry')
			   AND graph = $1
			   AND attributes->>'structmem' = 'true'
			   AND attributes->>'eventId' IN (${placeholders.join(", ")})
			 ORDER BY created_at ASC`,
				params,
			);
			return ((queryResult as { rows?: StructMemNodeRow[] }).rows ??
				[]) as StructMemNodeRow[];
		},
	);

	return dedupeEntries(rows.map(nodeRowToStructMemEntry));
}

const definition = defineStep<
	StructMemLoadRelatedEventsInput,
	StructMemLoadRelatedEventsOutput,
	StructMemLoadRelatedEventsServices,
	StructMemLoadRelatedEventsConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			const graphId = input.graphId?.trim() || "default";
			const bufferedEntries = input.bufferedEntries ?? [];
			if (bufferedEntries.length === 0) {
				return {
					output: {
						relatedEntries: [],
						reconstructedEvents: [],
						processingStage: "cross_event_consolidation",
					},
				};
			}

			const excludedNodeIds = new Set(
				bufferedEntries
					.map((entry) => entry.nodeId)
					.filter((nodeId): nodeId is string => Boolean(nodeId)),
			);
			const queryText = bufferedEntries.map((entry) => entry.text).join("\n");
			const seedEntries = await loadSeedEntries(
				services,
				graphId,
				queryText,
				config?.semanticSeedLimit ?? 15,
				excludedNodeIds,
			);
			const eventIds = Array.from(
				new Set(seedEntries.map((entry) => entry.eventId)),
			);
			const relatedEntries = await reconstructEventsByIds(
				services,
				graphId,
				eventIds,
			);
			const reconstructedEvents = buildReconstructedEvents([
				...bufferedEntries,
				...relatedEntries,
			]);

			logInfo("[STRUCTMEM_LOAD_RELATED] Loaded related events", {
				seedCount: seedEntries.length,
				relatedEntryCount: relatedEntries.length,
				eventCount: reconstructedEvents.length,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "StructMem Related Events Loaded",
						description: `Loaded ${seedEntries.length} seed entries and reconstructed ${reconstructedEvents.length} events`,
						metadata: { seedCount: seedEntries.length },
					},
				],
			});

			return {
				output: {
					relatedEntries,
					reconstructedEvents,
					processingStage: "cross_event_consolidation",
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_LOAD_RELATED] Error", error);
			return {
				output: {
					relatedEntries: [],
					reconstructedEvents: [],
					processingStage: "cross_event_consolidation",
					errors: [
						error instanceof Error
							? error.message
							: "StructMem related event loading failed",
					],
				},
			};
		}
	},
});

type StructMemLoadRelatedEventsSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemLoadRelatedEventsStep: StepFactoryFromSpec<
	StructMemLoadRelatedEventsSpec
> = (
	services: StructMemLoadRelatedEventsServices,
	config?: StructMemLoadRelatedEventsConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStructMemLoadRelatedEventsStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemLoadRelatedEventsSpec;
	}
}
