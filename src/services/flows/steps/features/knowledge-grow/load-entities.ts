import { getKnowledgeDatabase } from "../../../interfaces/knowledge";
import { logInfo, logError } from "../../../interfaces/logger";
import { and, or, ilike } from "drizzle-orm";
import { vectorSearchNodes } from "../../../utils/vector-search";
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
	trigramSearchNodes,
} from "../../../utils/trigram-search";

const STEP_NAME = "load-entities" as const;

export interface ExtractedEntity {
	uuid: string;
	name: string;
	summary?: string;
	nodeType: string;
	attributes?: Record<string, unknown>;
}

export interface LoadEntitiesInput {
	graphId?: string;
	extractedEntities?: ExtractedEntity[];
}

export interface LoadEntitiesOutput {
	existingEdges?: Edge[];
	existingNodes?: Node[];
	error?: string;
}

export type LoadFactsServices = Pick<AllServices, "database" | "embedding">;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	LoadEntitiesInput,
	LoadEntitiesOutput,
	LoadFactsServices,
	{}
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			logInfo("[LOAD_ENTITIES] Loading related existing nodes for resolution");

			const databaseService = services.database;
			const embeddingService = services.embedding;

			if (!databaseService) {
				throw new Error("Database service not available");
			}

			// If we have no extracted entities yet, skip
			const names = (input.extractedEntities || [])
				.map((e) => e.name)
				.filter((n) => n && n.trim().length > 0);
			if (names.length === 0) {
				return { output: { existingNodes: [], existingEdges: [] } };
			}

			const TOTAL_LIMIT = 200;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// Perform SQL search (existing logic)
			const sqlResults: Node[] = await getKnowledgeDatabase(
				databaseService,
			).query(async ({ db, schema }) => {
				const conditions = names.flatMap((n) => {
					const pat = `%${n}%`;
					return [
						ilike(schema.nodes.name, pat),
						ilike(schema.nodes.summary, pat),
					];
				});
				if (conditions.length === 0)
					return [] as (typeof schema.nodes.$inferSelect)[];

				const where = and(
					or(...conditions),
					getScopedGraphWhere(input, schema.nodes.graph),
				);

				const nodes = await db
					.select()
					.from(schema.nodes)
					.where(where!)
					.limit(Math.floor((TOTAL_LIMIT * WEIGHTS.sqlPercentage) / 100));
				return nodes;
			});

			// Perform trigram search for fuzzy text matching
			let trigramResults: Awaited<ReturnType<typeof trigramSearchNodes>> = [];
			try {
				const resultLimit = Math.floor(
					(TOTAL_LIMIT * WEIGHTS.trigramPercentage) / 100,
				);
				trigramResults = await trigramSearchNodes(
					databaseService,
					names,
					resultLimit * 2, // Get more results only if we need to filter
					{ threshold: 0.1 },
					input.graphId,
				);
			} catch (error) {
				logError("[LOAD_ENTITIES] Trigram search failed:", error);
			}

			// Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorResults: { item: Node; similarity: number }[] = [];
			const combinedResults = sqlResults.length + trigramResults.length;

			if (combinedResults < TOTAL_LIMIT * 0.5 && embeddingService) {
				// Less than 50% of desired results
				try {
					const defaultEmbedding = await embeddingService.get("default");
					if (defaultEmbedding && defaultEmbedding.isReady()) {
						const vectorLimit = Math.min(
							TOTAL_LIMIT - combinedResults,
							Math.floor(TOTAL_LIMIT * 0.4),
						);
						vectorResults = await vectorSearchNodes(
							databaseService,
							defaultEmbedding,
							names,
							vectorLimit,
							input.graphId,
						);
					}
				} catch (error) {
					logError("[LOAD_ENTITIES] Vector search fallback failed:", error);
				}
			}

			// Combine results with deduplication - use new trigram combiner
			const related = combineSearchResultsWithTrigram<Node>(
				sqlResults,
				vectorResults,
				trigramResults,
				WEIGHTS,
				TOTAL_LIMIT,
				(node) => String(node.id ?? ""),
			);

			logInfo(
				`[LOAD_ENTITIES] Loaded ${related.length} related nodes (${sqlResults.length} SQL, ${trigramResults.length} trigram, ${vectorResults.length} vector)`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Related Nodes Loaded",
					description: `Loaded ${related.length} related nodes for entity resolution (${sqlResults.length} SQL + ${trigramResults.length} trigram + ${vectorResults.length} vector)`,
					metadata: {
						nodeCount: related.length,
						sqlCount: sqlResults.length,
						trigramCount: trigramResults.length,
						vectorCount: vectorResults.length,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					existingNodes: related as Node[],
					// Defer edge loading; load_facts will query per facts
					existingEdges: [],
				},
			};
		} catch (error) {
			logError("[LOAD_ENTITIES] Error:", error);
			return {
				output: {
					errors: [
						error instanceof Error
							? error.message
							: "Failed to load existing data",
					],
					existingNodes: [],
					existingEdges: [],
				},
			};
		}
	},
});

type LoadEntitiesSpec = StepSpecFromDefinition<typeof definition>;

export const createLoadFactsStep: StepFactoryFromSpec<LoadEntitiesSpec> = (
	services: LoadFactsServices,
	config?: {},
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createLoadFactsStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: LoadEntitiesSpec;
	}
}
