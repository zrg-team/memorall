import { getKnowledgeDatabase } from "../../interfaces/knowledge";
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
	StructMemSummary,
} from "../../graph/structmem/state";
import { withEmbeddingField } from "./structmem-utils";
import { logError, logInfo } from "../../interfaces/logger";

const STEP_NAME = "structmem-save-consolidation" as const;

export interface StructMemSaveConsolidationInput {
	sourceId?: string;
	graphId?: string;
	consolidatedSummaries: StructMemSummary[];
	bufferedEntries: StructMemEntry[];
	relatedEntries: StructMemEntry[];
}

export interface StructMemSaveConsolidationOutput {
	consolidatedSummaries?: StructMemSummary[];
	createdNodes?: Node[];
	createdEdges?: Edge[];
	processingStage?: StructMemState["processingStage"];
	response?: string;
	errors?: string[];
}

type StructMemSaveConsolidationServices = Pick<
	AllServices,
	"database" | "embedding"
>;

const definition = defineStep<
	StructMemSaveConsolidationInput,
	StructMemSaveConsolidationOutput,
	StructMemSaveConsolidationServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			const graphId = input.graphId?.trim() || "default";
			const summaries = input.consolidatedSummaries ?? [];
			if (summaries.length === 0) {
				return {
					output: {
						processingStage: "completed",
						response: "StructMem consolidation skipped; no summaries produced.",
					},
				};
			}

			const entryNodeIdByUuid = new Map<string, string>();
			for (const entry of [...input.bufferedEntries, ...input.relatedEntries]) {
				if (entry.nodeId) entryNodeIdByUuid.set(entry.uuid, entry.nodeId);
			}

			const createdNodes: Node[] = [];
			const createdEdges: Edge[] = [];

			await getKnowledgeDatabase(services.database).query(
				async ({ db, schema }) => {
					for (const summary of summaries) {
						const nodeData: NewNode = {
							nodeType: "structmem_summary",
							name: `StructMem synthesis ${new Date().toISOString()}`,
							summary: summary.text,
							attributes: {
								structmem: true,
								summaryUuid: summary.uuid,
								summaryKind: "cross_event_consolidation",
								sourceEventIds: summary.sourceEventIds,
								sourceEntryIds: summary.sourceEntryIds,
								seedEntryIds: summary.seedEntryIds,
								timestampCitations: summary.timestampCitations,
								metadata: summary.metadata ?? {},
							},
							graph: graphId,
						};
						await withEmbeddingField(
							services.embedding,
							summary.text,
							nodeData as Record<string, unknown>,
							`STRUCTMEM_SUMMARY:${summary.uuid}`,
						);

						const [createdNode] = await db
							.insert(schema.nodes)
							.values(nodeData)
							.returning();
						createdNodes.push(createdNode);
						summary.nodeId = createdNode.id;

						if (input.sourceId) {
							await db.insert(schema.sourceNodes).values({
								sourceId: input.sourceId,
								nodeId: createdNode.id,
								relation: "STRUCTMEM_SYNTHESIS_FROM",
								attributes: {
									structmem: true,
									summaryUuid: summary.uuid,
								},
								graph: graphId,
							});
						}

						for (const entryUuid of summary.sourceEntryIds) {
							const entryNodeId = entryNodeIdByUuid.get(entryUuid);
							if (!entryNodeId) continue;
							const edgeData: NewEdge = {
								sourceId: createdNode.id,
								destinationId: entryNodeId,
								edgeType: "CONSOLIDATES",
								factText: summary.text,
								recordedAt: new Date(),
								attributes: {
									structmem: true,
									role: "summary_to_source_entry",
									summaryUuid: summary.uuid,
									sourceEntryId: entryUuid,
								},
								graph: graphId,
							};
							const [edge] = await db
								.insert(schema.edges)
								.values(edgeData)
								.returning();
							createdEdges.push(edge);

							if (input.sourceId) {
								await db.insert(schema.sourceEdges).values({
									sourceId: input.sourceId,
									edgeId: edge.id,
									relation: "STRUCTMEM_CONSOLIDATES",
									linkWeight: 1.0,
									attributes: {
										structmem: true,
										summaryUuid: summary.uuid,
										sourceEntryId: entryUuid,
									},
									graph: graphId,
								});
							}
						}
					}
				},
			);

			logInfo("[STRUCTMEM_SAVE_CONSOLIDATION] Saved summaries", {
				nodeCount: createdNodes.length,
				edgeCount: createdEdges.length,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "StructMem Consolidation Saved",
						description: `Saved ${createdNodes.length} synthesis memories`,
						metadata: {
							nodeCount: createdNodes.length,
							edgeCount: createdEdges.length,
						},
					},
				],
			});

			return {
				output: {
					consolidatedSummaries: summaries,
					createdNodes,
					createdEdges,
					processingStage: "completed",
					response: `StructMem consolidation completed. Created ${createdNodes.length} synthesis memories and ${createdEdges.length} consolidation links.`,
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_SAVE_CONSOLIDATION] Error", error);
			return {
				output: {
					processingStage: "completed",
					errors: [
						error instanceof Error
							? error.message
							: "StructMem consolidation save failed",
					],
				},
			};
		}
	},
});

type StructMemSaveConsolidationSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemSaveConsolidationStep: StepFactoryFromSpec<
	StructMemSaveConsolidationSpec
> = (services: StructMemSaveConsolidationServices) =>
	bindStep(definition, services);

stepRegistry.register(STEP_NAME, createStructMemSaveConsolidationStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemSaveConsolidationSpec;
	}
}
