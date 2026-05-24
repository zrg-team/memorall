import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { eq } from "drizzle-orm";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type { Node, NewNode } from "../../interfaces/knowledge";
import type { Edge, NewEdge } from "../../interfaces/knowledge";
import type {
	StructMemEntry,
	StructMemState,
} from "../../graph/structmem/state";
import {
	compactEntryLabel,
	dedupeEntries,
	nodeRowToStructMemEntry,
	type StructMemNodeRow,
	withEmbeddingField,
} from "./structmem-utils";
import { logError, logInfo } from "../../interfaces/logger";

const STEP_NAME = "structmem-save-event" as const;

export interface StructMemSaveEventInput {
	sourceId?: string;
	graphId?: string;
	title?: string;
	url?: string;
	referenceTimestamp: string;
	eventId?: string;
	factualEntries: StructMemEntry[];
	relationalEntries: StructMemEntry[];
}

export interface StructMemSaveEventOutput {
	factualEntries?: StructMemEntry[];
	relationalEntries?: StructMemEntry[];
	bufferedEntries?: StructMemEntry[];
	createdNodes?: Node[];
	createdEdges?: Edge[];
	shouldConsolidate?: boolean;
	processingStage?: StructMemState["processingStage"];
	errors?: string[];
}

export interface StructMemSaveEventConfig {
	consolidationWindowMs?: number;
}

type StructMemSaveEventServices = Pick<AllServices, "database" | "embedding">;

async function getLatestSummaryCreatedAt(
	services: StructMemSaveEventServices,
	graphId: string,
): Promise<string | undefined> {
	const result = await getKnowledgeDatabase(services.database).query(
		async ({ raw }) => {
			const queryResult = await raw(
				`SELECT created_at
			 FROM nodes
			 WHERE node_type = 'structmem_summary'
			   AND graph = $1
			   AND attributes->>'structmem' = 'true'
			 ORDER BY created_at DESC
			 LIMIT 1`,
				[graphId],
			);
			return ((queryResult as { rows?: Array<{ created_at?: string }> }).rows ??
				[]) as Array<{ created_at?: string }>;
		},
	);
	return result[0]?.created_at;
}

async function loadBufferedEntries(
	services: StructMemSaveEventServices,
	graphId: string,
	latestSummaryCreatedAt?: string,
): Promise<StructMemEntry[]> {
	const result = await getKnowledgeDatabase(services.database).query(
		async ({ raw }) => {
			const params: string[] = [graphId];
			let query = `SELECT id, node_type, name, summary, attributes, graph, created_at, updated_at
			FROM nodes
			WHERE node_type IN ('structmem_entry', 'structmem_factual_entry', 'structmem_relational_entry')
			  AND graph = $1
			  AND attributes->>'structmem' = 'true'`;

			if (latestSummaryCreatedAt) {
				query += ` AND created_at > $2::timestamp`;
				params.push(latestSummaryCreatedAt);
			}

			query += ` ORDER BY created_at ASC`;
			const queryResult = await raw(query, params);
			return ((queryResult as { rows?: StructMemNodeRow[] }).rows ??
				[]) as StructMemNodeRow[];
		},
	);

	return dedupeEntries(result.map(nodeRowToStructMemEntry));
}

function shouldConsolidateBufferedEntries(
	bufferedEntries: StructMemEntry[],
	windowMs: number,
	latestSummaryCreatedAt?: string,
): boolean {
	if (bufferedEntries.length === 0) return false;
	const timestamps = bufferedEntries
		.map((entry) => Date.parse(entry.timestamp))
		.filter((value) => Number.isFinite(value));
	if (timestamps.length === 0) return false;

	const newest = Math.max(...timestamps);
	const anchor = latestSummaryCreatedAt
		? Date.parse(latestSummaryCreatedAt)
		: Math.min(...timestamps);
	if (!Number.isFinite(anchor)) return false;

	return newest - anchor >= windowMs;
}

const definition = defineStep<
	StructMemSaveEventInput,
	StructMemSaveEventOutput,
	StructMemSaveEventServices,
	StructMemSaveEventConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			const graphId = input.graphId?.trim() || "default";
			const entries = [...input.factualEntries, ...input.relationalEntries];
			const eventId = input.eventId ?? entries[0]?.eventId;
			if (entries.length === 0) {
				return {
					output: {
						bufferedEntries: [],
						shouldConsolidate: false,
						processingStage: "completed",
					},
				};
			}
			if (!input.sourceId) {
				return {
					output: {
						errors: ["StructMem save event requires sourceId"],
						processingStage: "completed",
					},
				};
			}

			const createdNodes: Node[] = [];
			const createdEdges: Edge[] = [];
			await getKnowledgeDatabase(services.database).query(
				async ({ db, schema }) => {
					const [source] = await db
						.select()
						.from(schema.sources)
						.where(eq(schema.sources.id, input.sourceId || ""))
						.limit(1);
					if (!source) {
						throw new Error(`Source not found with id: ${input.sourceId}`);
					}

					const eventNodeData: NewNode = {
						nodeType: "structmem_event",
						name: `Event ${input.referenceTimestamp}`,
						summary: entries.map((entry) => entry.text).join("\n"),
						attributes: {
							structmem: true,
							eventId,
							timestamp: input.referenceTimestamp,
							sourceId: input.sourceId,
							title: input.title,
							url: input.url,
							entryCount: entries.length,
						},
						graph: graphId,
					};
					await withEmbeddingField(
						services.embedding,
						String(eventNodeData.summary ?? eventNodeData.name ?? ""),
						eventNodeData as Record<string, unknown>,
						`STRUCTMEM_EVENT:${eventId}`,
					);
					const [eventNode] = await db
						.insert(schema.nodes)
						.values(eventNodeData)
						.returning();
					createdNodes.push(eventNode);
					await db.insert(schema.sourceNodes).values({
						sourceId: source.id,
						nodeId: eventNode.id,
						relation: "STRUCTMEM_EVENT_FROM",
						attributes: {
							structmem: true,
							eventId,
						},
						graph: graphId,
					});

					for (const entry of entries) {
						const nodeData: NewNode = {
							nodeType:
								entry.entryKind === "relational"
									? "structmem_relational_entry"
									: "structmem_factual_entry",
							name: compactEntryLabel(entry),
							summary: entry.text,
							attributes: {
								structmem: true,
								entryUuid: entry.uuid,
								eventId: entry.eventId,
								entryKind: entry.entryKind,
								timestamp: entry.timestamp,
								sourceId: input.sourceId,
								title: entry.title ?? input.title,
								url: entry.url ?? input.url,
								confidence: entry.confidence,
								metadata: entry.metadata ?? {},
							},
							graph: graphId,
						};
						await withEmbeddingField(
							services.embedding,
							entry.text,
							nodeData as Record<string, unknown>,
							`STRUCTMEM_ENTRY:${entry.uuid}`,
						);

						const [createdNode] = await db
							.insert(schema.nodes)
							.values(nodeData)
							.returning();
						createdNodes.push(createdNode);
						entry.nodeId = createdNode.id;

						await db.insert(schema.sourceNodes).values({
							sourceId: source.id,
							nodeId: createdNode.id,
							relation: "STRUCTMEM_ENTRY_FROM",
							attributes: {
								structmem: true,
								eventId: entry.eventId,
								entryKind: entry.entryKind,
							},
							graph: graphId,
						});

						const edgeData: NewEdge = {
							sourceId: eventNode.id,
							destinationId: createdNode.id,
							edgeType: "HAS_ENTRY",
							factText: `Event ${entry.eventId} includes ${entry.entryKind} memory: ${entry.text}`,
							recordedAt: new Date(),
							attributes: {
								structmem: true,
								role: "event_entry_membership",
								eventId: entry.eventId,
								entryKind: entry.entryKind,
							},
							graph: graphId,
						};
						const [edge] = await db
							.insert(schema.edges)
							.values(edgeData)
							.returning();
						createdEdges.push(edge);
						await db.insert(schema.sourceEdges).values({
							sourceId: source.id,
							edgeId: edge.id,
							relation: "STRUCTMEM_EVENT_ENTRY",
							linkWeight: 1.0,
							attributes: { structmem: true, eventId: entry.eventId },
							graph: graphId,
						});
					}
				},
			);

			const latestSummaryCreatedAt = await getLatestSummaryCreatedAt(
				services,
				graphId,
			);
			const bufferedEntries = await loadBufferedEntries(
				services,
				graphId,
				latestSummaryCreatedAt,
			);
			const windowMs = config?.consolidationWindowMs ?? 60 * 60 * 1000;
			const shouldConsolidate = shouldConsolidateBufferedEntries(
				bufferedEntries,
				windowMs,
				latestSummaryCreatedAt,
			);

			logInfo("[STRUCTMEM_SAVE_EVENT] Saved event entries", {
				nodeCount: createdNodes.length,
				edgeCount: createdEdges.length,
				bufferedCount: bufferedEntries.length,
				shouldConsolidate,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "StructMem Event Saved",
						description: `Saved ${createdNodes.length} StructMem entries`,
						metadata: {
							shouldConsolidate,
							bufferedCount: bufferedEntries.length,
						},
					},
				],
			});

			return {
				output: {
					factualEntries: input.factualEntries,
					relationalEntries: input.relationalEntries,
					bufferedEntries,
					createdNodes,
					createdEdges,
					shouldConsolidate,
					processingStage: shouldConsolidate
						? "related_event_loading"
						: "completed",
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_SAVE_EVENT] Error", error);
			return {
				output: {
					errors: [
						error instanceof Error
							? error.message
							: "StructMem event save failed",
					],
					processingStage: "completed",
				},
			};
		}
	},
});

type StructMemSaveEventSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemSaveEventStep: StepFactoryFromSpec<
	StructMemSaveEventSpec
> = (services: StructMemSaveEventServices, config?: StructMemSaveEventConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStructMemSaveEventStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemSaveEventSpec;
	}
}
