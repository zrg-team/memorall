import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { logInfo, logError } from "../../interfaces/logger";
import { and, or, inArray } from "drizzle-orm";
import {
	vectorSearchEdges,
	vectorSearchNodes,
	type FlowEmbeddingLike,
} from "../../utils/vector-search";
import type { IDatabaseService } from "../../interfaces/database";
import type { Edge, Node } from "../../interfaces/knowledge";
import { getScopedGraphWhere } from "../../utils/graph-query";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";

const STEP_NAME = "quick-retrieve" as const;

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

export interface GraphGrowthConfig {
	maxLevels: number;
	nodesPerLevel: number;
	edgesPerLevel: number;
}

export interface QuickRetrieveConfig {
	maxGrowthLevels?: number;
	searchLimit?: number;
}

export interface QuickRetrieveInput {
	query: string;
	graphId?: string;
}

export interface QuickRetrieveOutput {
	relevantNodes?: RelevantNode[];
	relevantEdges?: RelevantEdge[];
	extractedEntities?: string[];
	queryIntent?: string;
	next?: string;
	errors?: string[];
}

export type QuickRetrieveSerices = Pick<AllServices, "database" | "embedding">;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function performSemanticSearch(
	databaseService: IDatabaseService,
	embeddingService: FlowEmbeddingLike,
	query: string,
	limit: number,
	graphId?: string,
): Promise<{
	nodes: RelevantNode[];
	edges: RelevantEdge[];
}> {
	// Search for semantically relevant nodes
	const nodeResults = await vectorSearchNodes(
		databaseService,
		embeddingService,
		[query],
		Math.floor(limit * 0.6), // 60% for nodes
		graphId, // Use topicId as graphFilter parameter
	);

	// Search for semantically relevant edges
	const edgeResults = await vectorSearchEdges(
		databaseService,
		embeddingService,
		[query],
		Math.floor(limit * 0.4), // 40% for edges
		graphId, // Use topicId as graphFilter parameter
	);

	// Convert to state format
	const nodes: RelevantNode[] = nodeResults.map((result) => ({
		id: String(result.item.id),
		nodeType: result.item.nodeType || "",
		name: result.item.name || "",
		summary: result.item.summary || "",
		attributes: (result.item.attributes || {}) as Record<string, unknown>,
		relevanceScore: result.similarity,
	}));

	const edges: RelevantEdge[] = edgeResults
		.filter((result) => result.item.sourceId && result.item.destinationId) // Only include edges with valid IDs
		.map((result) => ({
			id: String(result.item.id),
			sourceId: String(result.item.sourceId),
			destinationId: String(result.item.destinationId),
			edgeType: result.item.edgeType || "",
			factText: result.item.factText || "",
			attributes: (result.item.attributes || {}) as Record<string, unknown>,
			relevanceScore: result.similarity,
		}));

	return { nodes, edges };
}

async function expandGraphLevel(
	databaseService: IDatabaseService,
	nodeIds: string[],
	maxNodes: number,
	maxEdges: number,
	graphId?: string,
): Promise<{
	newNodes: RelevantNode[];
	newEdges: RelevantEdge[];
	nextLevelNodeIds: Set<string>;
}> {
	if (nodeIds.length === 0) {
		return { newNodes: [], newEdges: [], nextLevelNodeIds: new Set() };
	}

	const result = await getKnowledgeDatabase(databaseService).query<{
		connectedEdges: Edge[];
		connectedNodes: Node[];
		newNodeIds: Set<string>;
	}>(async ({ db, schema }) => {
		// Find all edges connected to current nodes
		const connectedEdges: Edge[] = await db
			.select()
			.from(schema.edges)
			.where(
				and(
					or(
						inArray(schema.edges.sourceId, nodeIds),
						inArray(schema.edges.destinationId, nodeIds),
					),
					getScopedGraphWhere({ graphId }, schema.edges.graph),
				),
			)
			.limit(maxEdges);

		// Get all unique node IDs from the edges (excluding current nodes)
		const newNodeIds = new Set<string>();
		connectedEdges.forEach((edge) => {
			// Only process valid IDs
			if (edge.sourceId) {
				const sourceId = String(edge.sourceId);
				if (!nodeIds.includes(sourceId)) {
					newNodeIds.add(sourceId);
				}
			}
			if (edge.destinationId) {
				const destId = String(edge.destinationId);
				if (!nodeIds.includes(destId)) {
					newNodeIds.add(destId);
				}
			}
		});

		// Fetch the new nodes (limit to maxNodes)
		const newNodesArray = Array.from(newNodeIds).slice(0, maxNodes);
		const connectedNodes =
			newNodesArray.length > 0
				? await db
						.select()
						.from(schema.nodes)
						.where(inArray(schema.nodes.id, newNodesArray))
				: [];

		return { connectedEdges, connectedNodes, newNodeIds };
	});

	// Convert to state format
	const newNodes: RelevantNode[] = result.connectedNodes.map((node) => ({
		id: String(node.id),
		nodeType: node.nodeType || "Entity",
		name: node.name,
		summary: node.summary || "",
		attributes: (node.attributes || {}) as Record<string, unknown>,
		relevanceScore: 0.5, // Default for grown nodes
	}));

	const newEdges: RelevantEdge[] = result.connectedEdges
		.filter((edge) => edge.sourceId && edge.destinationId) // Only include edges with valid IDs
		.map((edge) => ({
			id: String(edge.id),
			sourceId: String(edge.sourceId),
			destinationId: String(edge.destinationId),
			edgeType: edge.edgeType,
			factText: edge.factText || "",
			attributes: (edge.attributes || {}) as Record<string, unknown>,
			relevanceScore: 0.5, // Default for grown edges
		}));

	return {
		newNodes,
		newEdges,
		nextLevelNodeIds: result.newNodeIds,
	};
}

async function growKnowledgeGraph(
	databaseService: IDatabaseService,
	initialNodes: RelevantNode[],
	initialEdges: RelevantEdge[],
	config: GraphGrowthConfig,
	graphId?: string,
): Promise<{
	nodes: RelevantNode[];
	edges: RelevantEdge[];
}> {
	const allNodes = new Map<string, RelevantNode>();
	const allEdges = new Map<string, RelevantEdge>();

	// Add initial results
	initialNodes.forEach((node) => allNodes.set(node.id, node));
	initialEdges.forEach((edge) => allEdges.set(edge.id, edge));

	let currentLevelNodeIds = new Set(initialNodes.map((n) => n.id));

	// Grow the graph level by level
	for (let level = 0; level < config.maxLevels; level++) {
		logInfo(
			`[QUICK_RETRIEVE] Growing graph level ${level + 1}/${config.maxLevels}`,
		);

		if (currentLevelNodeIds.size === 0) break;

		const { newNodes, newEdges, nextLevelNodeIds } = await expandGraphLevel(
			databaseService,
			Array.from(currentLevelNodeIds),
			config.nodesPerLevel,
			config.edgesPerLevel,
			graphId,
		);

		// Add new nodes and edges
		newNodes.forEach((node) => {
			if (!allNodes.has(node.id)) {
				allNodes.set(node.id, {
					...node,
					relevanceScore: Math.max(0.1, 0.8 - level * 0.2),
				});
			}
		});

		newEdges.forEach((edge) => {
			if (!allEdges.has(edge.id)) {
				allEdges.set(edge.id, {
					...edge,
					relevanceScore: Math.max(0.1, 0.8 - level * 0.2),
				});
			}
		});

		currentLevelNodeIds = nextLevelNodeIds;
	}

	return {
		nodes: Array.from(allNodes.values()).sort(
			(a, b) => b.relevanceScore - a.relevanceScore,
		),
		edges: Array.from(allEdges.values()).sort(
			(a, b) => b.relevanceScore - a.relevanceScore,
		),
	};
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	QuickRetrieveInput,
	QuickRetrieveOutput,
	QuickRetrieveSerices,
	QuickRetrieveConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			const effectiveConfig: Required<QuickRetrieveConfig> = {
				maxGrowthLevels: config?.maxGrowthLevels ?? 3,
				searchLimit: config?.searchLimit ?? 50,
			};

			logInfo(
				`[QUICK_RETRIEVE] Starting semantic search and graph growth for graphId: ${input.graphId}`,
			);

			const databaseService = services.database;
			const embeddingService = services.embedding;

			if (!databaseService) {
				throw new Error("Database service not available");
			}

			if (!embeddingService) {
				throw new Error("Embedding service not available");
			}

			// Get default embedding
			const defaultEmbedding = await embeddingService.get("default");
			if (!defaultEmbedding || !defaultEmbedding.isReady()) {
				throw new Error("Default embedding not ready");
			}

			// Step 1: Semantic search for initial nodes and edges
			const initialResults = await performSemanticSearch(
				databaseService,
				defaultEmbedding,
				input.query,
				effectiveConfig.searchLimit,
				input.graphId,
			);

			// Step 2: Grow the graph from initial results
			const grownResults = await growKnowledgeGraph(
				databaseService,
				initialResults.nodes,
				initialResults.edges,
				{
					maxLevels: effectiveConfig.maxGrowthLevels,
					nodesPerLevel: 20,
					edgesPerLevel: 30,
				},
				input.graphId,
			);

			logInfo("[QUICK_RETRIEVE] Results:", {
				initialNodes: initialResults.nodes.length,
				initialEdges: initialResults.edges.length,
				grownNodes: grownResults.nodes.length,
				grownEdges: grownResults.edges.length,
				growthLevels: effectiveConfig.maxGrowthLevels,
			});

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Quick Knowledge Retrieval Complete",
					description: `Found ${grownResults.nodes.length} nodes and ${grownResults.edges.length} relationships using semantic search and ${effectiveConfig.maxGrowthLevels} levels of graph growth`,
					metadata: {
						mode: "quick",
						initialNodeCount: initialResults.nodes.length,
						initialEdgeCount: initialResults.edges.length,
						grownNodeCount: grownResults.nodes.length,
						grownEdgeCount: grownResults.edges.length,
						growthLevels: effectiveConfig.maxGrowthLevels,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					relevantNodes: grownResults.nodes,
					relevantEdges: grownResults.edges,
					extractedEntities: [], // Not used in quick mode
					queryIntent: "factual", // Default intent for quick mode
					next: "build_context",
				},
			};
		} catch (error) {
			logError("[QUICK_RETRIEVE] Quick retrieve failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Quick Retrieve Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Quick retrieve failed",
					],
				},
			};
		}
	},
});

type QuickRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createQuickRetrieveStep: StepFactoryFromSpec<QuickRetrieveSpec> = (
	services: QuickRetrieveSerices,
	config?: QuickRetrieveConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createQuickRetrieveStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: QuickRetrieveSpec;
	}
}
