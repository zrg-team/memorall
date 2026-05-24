import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { logInfo, logError } from "../../interfaces/logger";
import { and, eq, like, or, desc } from "drizzle-orm";
import {
	combineSearchResultsWithTrigram,
	trigramSearchEdges,
	trigramSearchNodes,
} from "../../utils/trigram-search";
import {
	vectorSearchEdges,
	vectorSearchNodes,
	type VectorSearchResult,
} from "../../utils/vector-search";
import type { Edge, Node } from "../../interfaces/knowledge";
import { getScopedGraphWhere } from "../../utils/graph-query";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";

const STEP_NAME = "llm-retrieve" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface RelevantNode {
	id: string;
	nodeType: string;
	name: string;
	summary: string;
	attributes: Record<string, unknown>;
	relevanceScore: number;
}

export interface RelevantEdge {
	id: string;
	sourceId: string;
	destinationId: string;
	edgeType: string;
	factText: string;
	attributes: Record<string, unknown>;
	relevanceScore: number;
}

export interface LLMRetrieveInput {
	extractedEntities: string[];
	graphId?: string;
}

export interface LLMRetrieveOutput {
	relevantNodes?: RelevantNode[];
	relevantEdges?: RelevantEdge[];
	next?: string;
	errors?: string[];
}

export type LLMRetrieveServices = Pick<AllServices, "database" | "embedding">;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	LLMRetrieveInput,
	LLMRetrieveOutput,
	LLMRetrieveServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		const database = services.database;
		const embedding = services.embedding;

		try {
			let relevantNodes: RelevantNode[] = [];
			let relevantEdges: RelevantEdge[] = [];

			const TOTAL_NODE_LIMIT = 15;
			const TOTAL_EDGE_LIMIT = 20;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// 1. SQL search for nodes
			const sqlNodes: Node[] = await getKnowledgeDatabase(database).query(
				async ({ db, schema }) => {
					if (input.extractedEntities.length === 0) return [];

					const entitySearchConditions = input.extractedEntities.map((entity) =>
						or(
							like(schema.nodes.name, `%${entity}%`),
							like(schema.nodes.summary, `%${entity}%`),
						),
					);

					// Add topic filter if provided
					const whereConditions = and(
						or(...entitySearchConditions),
						getScopedGraphWhere(input, schema.nodes.graph),
					);

					return await db
						.select({
							id: schema.nodes.id,
							nodeType: schema.nodes.nodeType,
							name: schema.nodes.name,
							summary: schema.nodes.summary,
							attributes: schema.nodes.attributes,
							nameEmbedding: schema.nodes.nameEmbedding,
							createdAt: schema.nodes.createdAt,
							updatedAt: schema.nodes.updatedAt,
						})
						.from(schema.nodes)
						.where(whereConditions)
						.orderBy(desc(schema.nodes.createdAt))
						.limit(
							Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.sqlPercentage) / 100),
						);
				},
			);

			// 2. SQL search for edges
			const sqlEdges: Edge[] = await getKnowledgeDatabase(database).query(
				async ({ db, schema }) => {
					if (input.extractedEntities.length === 0) return [];

					const factSearchConditions = input.extractedEntities.map((entity) =>
						like(schema.edges.factText, `%${entity}%`),
					);

					// Add topic filter if provided
					const whereConditions = and(
						or(...factSearchConditions),
						getScopedGraphWhere(input, schema.edges.graph),
					);

					return await db
						.select({
							id: schema.edges.id,
							sourceId: schema.edges.sourceId,
							destinationId: schema.edges.destinationId,
							edgeType: schema.edges.edgeType,
							factText: schema.edges.factText,
							validAt: schema.edges.validAt,
							invalidAt: schema.edges.invalidAt,
							recordedAt: schema.edges.recordedAt,
							attributes: schema.edges.attributes,
							isCurrent: schema.edges.isCurrent,
							provenanceWeightCache: schema.edges.provenanceWeightCache,
							provenanceCountCache: schema.edges.provenanceCountCache,
							factEmbedding: schema.edges.factEmbedding,
							typeEmbedding: schema.edges.typeEmbedding,
							graph: schema.edges.graph,
							createdAt: schema.edges.createdAt,
							updatedAt: schema.edges.updatedAt,
						})
						.from(schema.edges)
						.where(whereConditions)
						.orderBy(desc(schema.edges.createdAt))
						.limit(
							Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.sqlPercentage) / 100),
						);
				},
			);

			// 3. Trigram search for nodes
			let trigramNodeResults: Awaited<ReturnType<typeof trigramSearchNodes>> =
				[];
			if (input.extractedEntities.length > 0) {
				try {
					trigramNodeResults = await trigramSearchNodes(
						database,
						input.extractedEntities,
						Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 },
						input.graphId,
					);
				} catch (error) {
					logError(
						"[RETRIEVE_KNOWLEDGE] Trigram search for nodes failed:",
						error,
					);
				}
			}

			// 4. Trigram search for edges
			let trigramEdgeResults: Awaited<ReturnType<typeof trigramSearchEdges>> =
				[];
			if (input.extractedEntities.length > 0) {
				try {
					trigramEdgeResults = await trigramSearchEdges(
						database,
						input.extractedEntities,
						Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 },
						input.graphId,
					);
				} catch (error) {
					logError(
						"[RETRIEVE_KNOWLEDGE] Trigram search for edges failed:",
						error,
					);
				}
			}

			// 5. Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorNodes: VectorSearchResult<Node>[] = [];
			let vectorEdges: VectorSearchResult<Edge>[] = [];
			const combinedNodeResults = sqlNodes.length + trigramNodeResults.length;
			const combinedEdgeResults = sqlEdges.length + trigramEdgeResults.length;

			if (
				(combinedNodeResults < TOTAL_NODE_LIMIT * 0.5 ||
					combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) &&
				embedding
			) {
				try {
					const defaultEmbedding = await embedding.get("default");
					if (defaultEmbedding && defaultEmbedding.isReady()) {
						// Vector search for nodes
						if (combinedNodeResults < TOTAL_NODE_LIMIT * 0.5) {
							const nodeLimit = Math.min(
								TOTAL_NODE_LIMIT - combinedNodeResults,
								Math.floor(TOTAL_NODE_LIMIT * 0.4),
							);
							vectorNodes = await vectorSearchNodes(
								database,
								defaultEmbedding,
								input.extractedEntities,
								nodeLimit,
								input.graphId,
							);
						}

						// Vector search for edges
						if (combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) {
							const edgeLimit = Math.min(
								TOTAL_EDGE_LIMIT - combinedEdgeResults,
								Math.floor(TOTAL_EDGE_LIMIT * 0.4),
							);
							vectorEdges = await vectorSearchEdges(
								database,
								defaultEmbedding,
								input.extractedEntities,
								edgeLimit,
								input.graphId,
							);
						}
					}
				} catch (embeddingError) {
					logError(
						"[RETRIEVE_KNOWLEDGE] Vector search fallback failed:",
						embeddingError,
					);
				}
			}

			// 6. Combine results using trigram combiner
			const combinedNodes = combineSearchResultsWithTrigram<Node>(
				sqlNodes,
				vectorNodes.map((node) => ({
					item: node.item,
					similarity:
						"similarity" in node && typeof node.similarity === "number"
							? node.similarity
							: 0,
				})),
				trigramNodeResults,
				WEIGHTS,
				TOTAL_NODE_LIMIT,
				(node) => String(node.id ?? ""),
			);

			const combinedEdges = combineSearchResultsWithTrigram<Edge>(
				sqlEdges,
				vectorEdges.map((edge) => ({
					item: edge.item,
					similarity:
						"similarity" in edge && typeof edge.similarity === "number"
							? edge.similarity
							: 0,
				})),
				trigramEdgeResults,
				WEIGHTS,
				TOTAL_EDGE_LIMIT,
				(edge) => String(edge.id ?? ""),
			);

			// 7. Process and score nodes
			relevantNodes = combinedNodes.map((node) => {
				let relevanceScore = 0;

				// Text-based relevance
				input.extractedEntities.forEach((entity) => {
					const entityLower = entity.toLowerCase();
					if (`${node.name}`.toLowerCase().includes(entityLower)) {
						relevanceScore += 3;
					}
					if (`${node.summary}`.toLowerCase().includes(entityLower)) {
						relevanceScore += 2;
					}
				});

				return {
					id: `${node.id}`,
					nodeType: node.nodeType ? `${node.nodeType}` : "",
					name: node.name ? `${node.name}` : "",
					summary: node.summary ? `${node.summary}` : "",
					attributes: (node.attributes as Record<string, unknown>) || {},
					relevanceScore,
				};
			});

			// 8. Get missing nodes for complete fact context
			const edgeNodeIds = [
				...new Set([
					...combinedEdges.map((edge) => edge.sourceId),
					...combinedEdges.map((edge) => edge.destinationId),
				]),
			].filter((id) => id !== null && id !== undefined && id !== ""); // Filter out invalid IDs

			const missingNodeIds = edgeNodeIds.filter(
				(id) => !relevantNodes.find((node) => node.id === id),
			);

			if (missingNodeIds.length > 0) {
				const missingNodes = await getKnowledgeDatabase(database).query<Node[]>(
					async ({ db, schema }) => {
						return await db
							.select({
								id: schema.nodes.id,
								nodeType: schema.nodes.nodeType,
								name: schema.nodes.name,
								summary: schema.nodes.summary,
								attributes: schema.nodes.attributes,
							})
							.from(schema.nodes)
							.where(
								or(...missingNodeIds.map((id) => eq(schema.nodes.id, id!))),
							);
					},
				);

				const additionalNodes = missingNodes.map((node) => ({
					id: node.id,
					nodeType: node.nodeType || "Entity",
					name: node.name,
					summary: node.summary || "",
					attributes: (node.attributes as Record<string, unknown>) || {},
					relevanceScore: 1,
				}));

				relevantNodes = [...relevantNodes, ...additionalNodes];
			}

			// 9. Process edges
			relevantEdges = combinedEdges.map((edge) => {
				let relevanceScore = 0;

				// Score based on fact text relevance
				input.extractedEntities.forEach((entity) => {
					if (
						(edge.factText ?? "").toLowerCase().includes(entity.toLowerCase())
					) {
						relevanceScore += 2;
					}
				});

				// Boost score if both source and destination are relevant nodes
				const allNodeIds = relevantNodes.map((node) => node.id);
				const sourceRelevant = allNodeIds.includes(`${edge.sourceId}`);
				const destRelevant = allNodeIds.includes(`${edge.destinationId}`);
				if (sourceRelevant && destRelevant) {
					relevanceScore += 3;
				} else if (sourceRelevant || destRelevant) {
					relevanceScore += 1;
				}

				return {
					id: `${edge.id}`,
					sourceId: edge.sourceId ? `${edge.sourceId}` : "",
					destinationId: edge.destinationId ? `${edge.destinationId}` : "",
					edgeType: edge.edgeType ? `${edge.edgeType}` : "",
					factText: edge.factText ? `${edge.factText}` : "",
					attributes: (edge.attributes as Record<string, unknown>) || {},
					relevanceScore,
				};
			});

			// Sort by relevance
			relevantNodes.sort((a, b) => b.relevanceScore - a.relevanceScore);
			relevantEdges.sort((a, b) => b.relevanceScore - a.relevanceScore);

			logInfo("[RETRIEVE_KNOWLEDGE] Retrieved knowledge:", {
				nodes: relevantNodes.length,
				edges: relevantEdges.length,
				sqlNodes: sqlNodes.length,
				trigramNodes: trigramNodeResults.length,
				vectorNodes: vectorNodes.length,
				sqlEdges: sqlEdges.length,
				trigramEdges: trigramEdgeResults.length,
				vectorEdges: vectorEdges.length,
			});

			const actions =
				relevantNodes?.length || relevantEdges?.length
					? [
							{
								id: crypto.randomUUID(),
								name: "Knowledge Retrieval Complete",
								description: `Found ${relevantNodes.length} nodes and ${relevantEdges.length} relationships (${sqlNodes.length}+${trigramNodeResults.length}+${vectorNodes.length} nodes, ${sqlEdges.length}+${trigramEdgeResults.length}+${vectorEdges.length} edges)`,
								metadata: {
									nodeCount: relevantNodes.length,
									edgeCount: relevantEdges.length,
									sqlNodeCount: sqlNodes.length,
									trigramNodeCount: trigramNodeResults.length,
									vectorNodeCount: vectorNodes.length,
									sqlEdgeCount: sqlEdges.length,
									trigramEdgeCount: trigramEdgeResults.length,
									vectorEdgeCount: vectorEdges.length,
								},
							},
						]
					: [];
			if (actions.length) {
				runConfig?.writer?.({ type: "actions", actions });
			}

			return {
				output: {
					relevantNodes,
					relevantEdges,
					next: "build_context",
				},
			};
		} catch (error) {
			logError("[RETRIEVE_KNOWLEDGE] Knowledge retrieval failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Knowledge Retrieval Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error
							? error.message
							: "Knowledge retrieval failed",
					],
				},
			};
		}
	},
});

type LLMRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createStep: StepFactoryFromSpec<LLMRetrieveSpec> = (
	services: LLMRetrieveServices,
) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: LLMRetrieveSpec;
	}
}
