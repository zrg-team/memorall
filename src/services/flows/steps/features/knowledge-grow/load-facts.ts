import { getKnowledgeDatabase } from "../../../interfaces/knowledge";
import { logInfo, logError } from "../../../interfaces/logger";
import { and, or, inArray, ilike } from "drizzle-orm";
import { vectorSearchEdges } from "../../../utils/vector-search";
import type { Edge, Node } from "../../../interfaces/knowledge";
import { getScopedGraphWhere } from "../../../utils/graph-query";

import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import type { AllServices } from "../../../interfaces/tool";
import {
	combineSearchResultsWithTrigram,
	trigramSearchEdges,
} from "../../../utils/trigram-search";

const STEP_NAME = "load-facts" as const;

export interface ExtractedEntity {
	uuid: string;
	name: string;
	summary?: string;
	nodeType: string;
	attributes?: Record<string, unknown>;
}

export interface ResolvedEntity extends ExtractedEntity {
	isExisting: boolean;
	existingId?: string;
	finalName: string;
}

export interface ExtractedFact {
	uuid: string;
	sourceEntityId: string;
	destinationEntityId: string;
	relationType: string;
	factText: string;
	attributes?: Record<string, unknown>;
}

export interface LoadFactsInput {
	graphId?: string;
	extractedFacts: ExtractedFact[];
	resolvedEntities: ResolvedEntity[];
	existingEdges: Edge[];
	existingNodes: Node[];
}

export interface LoadFactsOutput {
	existingEdges?: Edge[];
	existingNodes?: Node[];
	error?: string;
}

export type LoadFactsServices = Pick<AllServices, "database" | "embedding">;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	LoadFactsInput,
	LoadFactsOutput,
	LoadFactsServices,
	{}
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			logInfo("[LOAD_FACTS] Loading related edges for fact resolution");
			const databaseService = services.database;
			const embeddingService = services.embedding;

			if (!databaseService) {
				throw new Error("Database service not available");
			}

			if (!input.extractedFacts || input.extractedFacts.length === 0) {
				return { output: {} };
			}

			const TOTAL_LIMIT = 500;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// Collect candidate node IDs from resolved entities
			const candidateIds = new Set<string>();
			for (const ent of input.resolvedEntities || []) {
				if (ent.isExisting && ent.existingId) candidateIds.add(ent.existingId);
			}
			const unresolvedNames = (input.resolvedEntities || [])
				.filter((e) => !e.isExisting || !e.existingId)
				.map((e) => e.finalName);

			// Find additional nodes for unresolved entities
			if (unresolvedNames.length > 0) {
				const found: { id: string }[] = await getKnowledgeDatabase(
					databaseService,
				).query(async ({ db, schema }) => {
					const conditions = unresolvedNames.flatMap((n) => {
						const pat = `%${n}%`;
						return [
							ilike(schema.nodes.name, pat),
							ilike(schema.nodes.summary, pat),
						];
					});
					if (conditions.length === 0) return [] as { id: string }[];

					const where = and(
						or(...conditions),
						getScopedGraphWhere(input, schema.nodes.graph),
					);

					const rows = await db
						.select({ id: schema.nodes.id })
						.from(schema.nodes)
						.where(where!)
						.limit(200);
					return rows;
				});
				for (const r of found) candidateIds.add(r.id);
			}

			const idList = Array.from(candidateIds);

			// 1. SQL-based edge search (relations from resolved entities)
			let sqlResults: Edge[] = [];
			if (idList.length > 0) {
				sqlResults = await getKnowledgeDatabase(databaseService).query(
					async ({ db, schema }) => {
						const where = and(
							or(
								inArray(schema.edges.sourceId, idList),
								inArray(schema.edges.destinationId, idList),
							),
							getScopedGraphWhere(input, schema.edges.graph),
						);

						return db
							.select()
							.from(schema.edges)
							.where(where!)
							.limit(Math.floor((TOTAL_LIMIT * WEIGHTS.sqlPercentage) / 100));
					},
				);
			}

			// 2. Trigram search based on extracted facts
			let trigramResults: Awaited<ReturnType<typeof trigramSearchEdges>> = [];
			if (input.extractedFacts.length > 0) {
				try {
					// Create search terms from extracted facts
					const factSearchTerms = input.extractedFacts
						.map((f) => `${f.relationType} ${f.factText || ""}`.trim())
						.filter((term) => term.length > 0);

					if (factSearchTerms.length > 0) {
						const resultLimit = Math.floor(
							(TOTAL_LIMIT * WEIGHTS.trigramPercentage) / 100,
						);
						trigramResults = await trigramSearchEdges(
							databaseService,
							factSearchTerms,
							resultLimit, // Get more results only if we need to filter
							{ threshold: 0.1 },
							input.graphId,
						);
					}
				} catch (error) {
					logError("[LOAD_FACTS] Trigram search failed:", error);
				}
			}

			// 3. Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorResults: { item: Edge; similarity: number }[] = [];
			const combinedResults = sqlResults.length + trigramResults.length;

			if (
				combinedResults < TOTAL_LIMIT * 0.5 &&
				embeddingService &&
				input.extractedFacts.length > 0
			) {
				try {
					const defaultEmbedding = await embeddingService.get("default");
					if (defaultEmbedding && defaultEmbedding.isReady()) {
						// Create search terms from extracted facts
						const factSearchTerms = input.extractedFacts
							.map((f) => `${f.relationType} ${f.factText || ""}`.trim())
							.filter((term) => term.length > 0);

						if (factSearchTerms.length > 0) {
							const vectorLimit = Math.min(
								TOTAL_LIMIT - combinedResults,
								Math.floor(TOTAL_LIMIT * 0.4),
							);
							vectorResults = await vectorSearchEdges(
								databaseService,
								defaultEmbedding,
								factSearchTerms,
								vectorLimit,
								input.graphId,
							);
						}
					}
				} catch (error) {
					logError("[LOAD_FACTS] Vector search fallback failed:", error);
				}
			}

			// 4. Additional relations from resolved entity connections (if space available)
			let relationResults: Edge[] = [];
			const usedSpace =
				sqlResults.length + trigramResults.length + vectorResults.length;
			const remainingSpace = TOTAL_LIMIT - usedSpace;

			if (remainingSpace > 0 && idList.length > 0) {
				// Find edges that connect any of our resolved entities to other entities
				relationResults = await getKnowledgeDatabase(databaseService).query(
					async ({ db, schema }) => {
						// Find edges where both source and destination are in our candidate list
						const where = and(
							inArray(schema.edges.sourceId, idList),
							inArray(schema.edges.destinationId, idList),
							getScopedGraphWhere(input, schema.edges.graph),
						);

						return db
							.select()
							.from(schema.edges)
							.where(where!)
							.limit(remainingSpace);
					},
				);
			}

			// Combine all results with deduplication using trigram combiner
			const edges = combineSearchResultsWithTrigram<Edge>(
				[...sqlResults, ...relationResults], // Combine SQL and relation results
				vectorResults,
				trigramResults,
				WEIGHTS,
				TOTAL_LIMIT,
				(edge) => String(edge.id ?? ""),
			);

			// Ensure node data for edges
			const nodeIds = Array.from(
				new Set<string>(
					edges.flatMap((e) => [`${e.sourceId}`, `${e.destinationId}`]),
				),
			);
			const missingNodeIds = nodeIds.filter(
				(id) => !(input.existingNodes || []).some((n) => n.id === id),
			);
			let newNodes: Node[] = [];
			if (missingNodeIds.length > 0) {
				newNodes = await getKnowledgeDatabase(databaseService).query(
					async ({ db, schema }) => {
						const where = and(
							inArray(schema.nodes.id, missingNodeIds),
							getScopedGraphWhere(input, schema.nodes.graph),
						);

						return db.select().from(schema.nodes).where(where);
					},
				);
			}

			logInfo(
				`[LOAD_FACTS] Loaded ${edges.length} related edges (${sqlResults.length} SQL, ${trigramResults.length} trigram, ${vectorResults.length} vector, ${relationResults.length} relations)`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Related Edges Loaded",
					description: `Loaded ${edges.length} related edges for fact resolution (${sqlResults.length} SQL + ${trigramResults.length} trigram + ${vectorResults.length} vector + ${relationResults.length} relations)`,
					metadata: {
						edgeCount: edges.length,
						sqlCount: sqlResults.length,
						trigramCount: trigramResults.length,
						vectorCount: vectorResults.length,
						relationCount: relationResults.length,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					existingEdges: edges as Edge[],
					existingNodes: (input.existingNodes || []).concat(newNodes),
				},
			};
		} catch (error) {
			logError("[LOAD_FACTS] Error:", error);
			return {
				output: {
					errors: [
						error instanceof Error
							? error.message
							: "Failed to load facts context",
					],
				},
			};
		}
	},
});

type LoadFactsSpec = StepSpecFromDefinition<typeof definition>;

export const createLoadFactsStep: StepFactoryFromSpec<LoadFactsSpec> = (
	services: LoadFactsServices,
	config?: {},
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createLoadFactsStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: LoadFactsSpec;
	}
}
