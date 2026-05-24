import { getKnowledgeDatabase } from "../../interfaces/knowledge";
/**
 * Smart Hybrid Retrieval Step for Knowledge RAG
 *
 * Combines semantic search with intelligent graph expansion and completeness verification.
 *
 * Algorithm Phases:
 * 1. Primary Query Seed Retrieval - Vector search for main query
 * 2. Context Query Seed Retrieval - Vector search for each context query
 * 3. Seed Merge - Merge primary + context seeds
 * 4. Smart Graph Expansion - Multi-level expansion with semantic filtering
 * 5. Completeness Verification - Ensure all query/context components are covered
 * 6. Multi-Factor Re-Ranking - Combine semantic, structural, and coverage scores
 * 7. Post-Expansion - Connect standalone nodes and edges
 */

import { logInfo, logError } from "../../interfaces/logger";
import {
	vectorSearchNodes,
	vectorSearchEdges,
} from "../../utils/vector-search";
import { and, or, inArray } from "drizzle-orm";
import { getScopedGraphWhere } from "../../utils/graph-query";
import type { Node, Edge } from "../../interfaces/knowledge";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";

const STEP_NAME = "smart-retrieve" as const;

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

export interface SmartRetrieveInput {
	query: string;
	graphId?: string;
	contextQueries?: string[];
}

export interface SmartRetrieveOutput {
	relevantNodes?: RelevantNode[];
	relevantEdges?: RelevantEdge[];
	extractedEntities?: string[];
	queryIntent?: string;
	next?: string;
	errors?: string[];
}

export type SmartRetrieveServices = Pick<AllServices, "database" | "embedding">;

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export type MMRMode = "focused" | "balanced" | "explore" | "custom";

export interface MMRConfig {
	enabled: boolean;
	mode: MMRMode;
	lambda?: number;
	candidateMultiplier?: number;
}

export interface SmartRetrievalConfig {
	seed: {
		nodeLimit: number;
		edgeLimit: number;
		nodeThreshold: number;
		edgeThreshold: number;
		mmr?: MMRConfig;
	};
	expansion: {
		maxLevels: number;
		levelThresholds: number[];
		maxNodesPerLevel: number;
		maxEdgesPerLevel: number;
	};
	completeness: {
		threshold: number;
		maxIterations: number;
		gapFillingLimit: number;
		minComponentLength: number;
	};
	ranking: {
		semanticWeight: number;
		centralityWeight: number;
		densityWeight: number;
		coverageWeight: number;
	};
	output: {
		maxNodes: number;
		maxEdges: number;
	};
	postExpansion: {
		enabled: boolean;
		maxIterations: number;
		growthLevels: number;
		maxNodesPerIteration: number;
		maxEdgesPerIteration: number;
	};
	topic?: {
		enabled: boolean;
		nodeLimit: number;
		edgeLimit: number;
		mmrMode: MMRMode;
		relevanceWeight: number;
	};
}

const MMR_MODE_LAMBDAS: Record<Exclude<MMRMode, "custom">, number> = {
	focused: 0.8,
	balanced: 0.6,
	explore: 0.4,
};

const DEFAULT_MMR_CONFIG: MMRConfig = {
	enabled: true,
	mode: "balanced",
	lambda: 0.6,
	candidateMultiplier: 2,
};

const DEFAULT_SMART_CONFIG: SmartRetrievalConfig = {
	seed: {
		nodeLimit: 20,
		edgeLimit: 30,
		nodeThreshold: 0.5,
		edgeThreshold: 0.4,
		mmr: DEFAULT_MMR_CONFIG,
	},
	expansion: {
		maxLevels: 3,
		levelThresholds: [0.5, 0.35, 0.2],
		maxNodesPerLevel: 15,
		maxEdgesPerLevel: 25,
	},
	completeness: {
		threshold: 0.8,
		maxIterations: 2,
		gapFillingLimit: 5,
		minComponentLength: 3,
	},
	ranking: {
		semanticWeight: 0.5,
		centralityWeight: 0.2,
		densityWeight: 0.15,
		coverageWeight: 0.15,
	},
	output: {
		maxNodes: 50,
		maxEdges: 70,
	},
	postExpansion: {
		enabled: true,
		maxIterations: 3,
		growthLevels: 2,
		maxNodesPerIteration: 30,
		maxEdgesPerIteration: 50,
	},
	topic: {
		enabled: true,
		nodeLimit: 10,
		edgeLimit: 15,
		mmrMode: "explore",
		relevanceWeight: 0.3,
	},
};

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface EnhancedNode {
	id: string;
	nodeType: string;
	name: string;
	summary: string;
	attributes: Record<string, unknown>;
	embedding: number[] | null;
	semanticScore: number;
	level: number;
	source: "seed" | "expansion" | "gap_filling";
	coverageContribution: number;
	centralityScore: number;
	edgeDensity: number;
	finalScore: number;
}

interface EnhancedEdge {
	id: string;
	sourceId: string;
	destinationId: string;
	edgeType: string;
	factText: string;
	attributes: Record<string, unknown>;
	embedding: number[] | null;
	semanticScore: number;
	level: number;
	source: "seed" | "expansion";
	finalScore?: number;
}

interface QueryComponent {
	text: string;
	covered: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function mergeConfig(
	defaults: SmartRetrievalConfig,
	overrides?: Partial<SmartRetrievalConfig>,
): SmartRetrievalConfig {
	if (!overrides) return defaults;

	return {
		seed: {
			...defaults.seed,
			...overrides.seed,
			mmr: overrides.seed?.mmr
				? { ...defaults.seed.mmr, ...overrides.seed.mmr }
				: defaults.seed.mmr,
		},
		expansion: { ...defaults.expansion, ...overrides.expansion },
		completeness: { ...defaults.completeness, ...overrides.completeness },
		ranking: { ...defaults.ranking, ...overrides.ranking },
		output: { ...defaults.output, ...overrides.output },
		postExpansion: { ...defaults.postExpansion, ...overrides.postExpansion },
		topic: overrides.topic
			? { ...defaults.topic, ...overrides.topic }
			: defaults.topic,
	};
}

function average(numbers: number[]): number {
	if (numbers.length === 0) return 0;
	return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	return denominator === 0 ? 0 : dotProduct / denominator;
}

function toEnhancedNode(
	node: Node,
	semanticScore: number,
	level: number,
	source: EnhancedNode["source"],
): EnhancedNode {
	return {
		id: node.id,
		nodeType: node.nodeType ?? "",
		name: node.name,
		summary: node.summary ?? "",
		attributes: (node.attributes as Record<string, unknown>) ?? {},
		embedding:
			(node.nameEmbedding as number[]) ??
			(node.nameEmbeddingSmall as number[]) ??
			null,
		semanticScore,
		level,
		source,
		finalScore: 0,
		edgeDensity: 0,
		centralityScore: 0,
		coverageContribution: 0,
	};
}

function toEnhancedEdge(
	edge: Edge,
	semanticScore: number,
	level: number,
	source: EnhancedEdge["source"],
): EnhancedEdge {
	return {
		id: edge.id,
		sourceId: edge.sourceId,
		destinationId: edge.destinationId,
		edgeType: edge.edgeType,
		factText: edge.factText ?? "",
		attributes: (edge.attributes as Record<string, unknown>) ?? {},
		embedding: (edge.factEmbedding as number[]) ?? null,
		semanticScore,
		level,
		source,
	};
}

function getMMRLambda(mmrConfig: MMRConfig): number {
	if (mmrConfig.mode === "custom") {
		return mmrConfig.lambda ?? MMR_MODE_LAMBDAS.balanced;
	}
	return MMR_MODE_LAMBDAS[mmrConfig.mode];
}

function applyMMR<
	T extends { embedding: number[] | null; semanticScore: number },
>(
	candidates: T[],
	queryEmbedding: number[],
	targetCount: number,
	lambda: number,
): T[] {
	if (candidates.length <= targetCount) {
		return candidates;
	}

	const selected: T[] = [];
	const remaining = [...candidates];

	remaining.sort((a, b) => b.semanticScore - a.semanticScore);
	selected.push(remaining.shift()!);

	while (selected.length < targetCount && remaining.length > 0) {
		let bestMMRScore = -Infinity;
		let bestIndex = -1;

		for (let i = 0; i < remaining.length; i++) {
			const candidate = remaining[i];
			if (!candidate.embedding) continue;

			const relevance = candidate.semanticScore;
			let maxSimilarityToSelected = 0;

			for (const selectedItem of selected) {
				if (!selectedItem.embedding) continue;
				const similarity = cosineSimilarity(
					candidate.embedding,
					selectedItem.embedding,
				);
				maxSimilarityToSelected = Math.max(maxSimilarityToSelected, similarity);
			}

			const mmrScore =
				lambda * relevance - (1 - lambda) * maxSimilarityToSelected;

			if (mmrScore > bestMMRScore) {
				bestMMRScore = mmrScore;
				bestIndex = i;
			}
		}

		if (bestIndex >= 0) {
			selected.push(remaining.splice(bestIndex, 1)[0]);
		} else {
			break;
		}
	}

	return selected;
}

const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"but",
	"in",
	"on",
	"at",
	"to",
	"for",
	"of",
	"with",
	"by",
	"from",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	"will",
	"would",
	"should",
	"could",
	"may",
	"might",
	"can",
	"what",
	"when",
	"where",
	"who",
	"which",
	"how",
	"why",
	"this",
	"that",
	"these",
	"those",
]);

function extractQueryComponents(
	query: string,
	minComponentLength: number,
): QueryComponent[] {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter((word) => {
			const cleaned = word.replace(/[^\w]/g, "");
			return cleaned.length >= minComponentLength && !STOP_WORDS.has(cleaned);
		});

	const phrases: string[] = [];
	for (let i = 0; i < words.length - 1; i++) {
		phrases.push(`${words[i]} ${words[i + 1]}`);
		if (i < words.length - 2) {
			phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
		}
	}

	const components = [...new Set([...words, ...phrases])].map((text) => ({
		text,
		covered: false,
	}));

	return components;
}

function checkCoverage(
	nodes: EnhancedNode[],
	queryComponents: QueryComponent[],
): { covered: number; total: number } {
	let covered = 0;

	for (const component of queryComponents) {
		const isFound = nodes.some(
			(node) =>
				node.name.toLowerCase().includes(component.text) ||
				node.summary.toLowerCase().includes(component.text),
		);

		if (isFound) {
			component.covered = true;
			covered++;
		}
	}

	return { covered, total: queryComponents.length };
}

async function calculateSemanticSimilarity(
	node: Node,
	queryEmbedding: number[],
): Promise<number> {
	const nodeEmbedding =
		node.nameEmbedding ?? node.nameEmbeddingSmall ?? node.nameEmbeddingLarge;

	if (!nodeEmbedding || !Array.isArray(nodeEmbedding)) {
		return 0.1;
	}

	if (nodeEmbedding.length !== queryEmbedding.length) {
		return 0.1;
	}

	return cosineSimilarity(nodeEmbedding, queryEmbedding);
}

function calculateGraphMetrics(
	nodes: EnhancedNode[],
	edges: EnhancedEdge[],
): {
	centrality: Map<string, number>;
	density: Map<string, number>;
} {
	const centrality = new Map<string, number>();
	const density = new Map<string, number>();

	const adjacency = new Map<string, Set<string>>();
	nodes.forEach((node) => adjacency.set(node.id, new Set()));

	edges.forEach((edge) => {
		adjacency.get(edge.sourceId)?.add(edge.destinationId);
		adjacency.get(edge.destinationId)?.add(edge.sourceId);
	});

	const maxDegree = Math.max(
		...Array.from(adjacency.values()).map((neighbors) => neighbors.size),
		1,
	);

	nodes.forEach((node) => {
		const degree = adjacency.get(node.id)?.size ?? 0;
		centrality.set(node.id, degree / maxDegree);
	});

	const totalNodes = nodes.length;
	nodes.forEach((node) => {
		const connectedEdges = edges.filter(
			(e) => e.sourceId === node.id || e.destinationId === node.id,
		);
		density.set(node.id, connectedEdges.length / totalNodes);
	});

	return { centrality, density };
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	SmartRetrieveInput,
	SmartRetrieveOutput,
	SmartRetrieveServices,
	Partial<SmartRetrievalConfig>
>({
	name: STEP_NAME,
	execute: async ({ input, services, config: configOverrides, runConfig }) => {
		try {
			const config = mergeConfig(DEFAULT_SMART_CONFIG, configOverrides);

			const { database, embedding } = services;

			if (!database) {
				throw new Error("Database service not available");
			}

			if (!embedding) {
				throw new Error("Embedding service not available");
			}

			const defaultEmbedding = await embedding.get("default");
			if (!defaultEmbedding || !defaultEmbedding.isReady()) {
				throw new Error("Default embedding not ready");
			}

			logInfo(`[SMART_RETRIEVE] Starting for graphId: ${input.graphId}`);
			const baseQuery = input.query.trim();

			// Phase 1: Primary Query Seed Retrieval
			const queryEmbedding = await defaultEmbedding.textToVector(baseQuery);

			const mmrConfig = config.seed.mmr ?? DEFAULT_MMR_CONFIG;
			const candidateMultiplier = mmrConfig.enabled
				? (mmrConfig.candidateMultiplier ?? 2)
				: 1;

			const nodeCandidateLimit = config.seed.nodeLimit * candidateMultiplier;

			const nodeResults = await vectorSearchNodes(
				database,
				defaultEmbedding,
				[baseQuery],
				nodeCandidateLimit,
				input.graphId,
			);

			const edgeResults = await vectorSearchEdges(
				database,
				defaultEmbedding,
				[baseQuery],
				config.seed.edgeLimit,
				input.graphId,
			);

			const nodeCandidates: EnhancedNode[] = nodeResults
				.filter((result) => result.similarity >= config.seed.nodeThreshold)
				.map((result) =>
					toEnhancedNode(result.item, result.similarity, 0, "seed"),
				);

			let primarySeedNodes: EnhancedNode[];
			if (mmrConfig.enabled && nodeCandidates.length > config.seed.nodeLimit) {
				primarySeedNodes = applyMMR(
					nodeCandidates,
					queryEmbedding,
					config.seed.nodeLimit,
					getMMRLambda(mmrConfig),
				);
			} else {
				primarySeedNodes = nodeCandidates.slice(0, config.seed.nodeLimit);
			}

			const primarySeedEdges: EnhancedEdge[] = edgeResults
				.filter((result) => result.similarity >= config.seed.edgeThreshold)
				.map((result) =>
					toEnhancedEdge(result.item, result.similarity, 0, "seed"),
				);

			logInfo(
				`[SMART_RETRIEVE] Phase 1: ${primarySeedNodes.length} primary seed nodes, ${primarySeedEdges.length} primary seed edges`,
			);

			// Phase 2: Context Query Seed Retrieval (separate from primary query)
			const contextSeedNodesMap = new Map<string, EnhancedNode>();
			const contextSeedEdgesMap = new Map<string, EnhancedEdge>();

			const contextQueries = (input.contextQueries ?? [])
				.map((text) => text.trim())
				.filter((text) => text.length > 0 && text !== baseQuery);

			for (const contextQuery of contextQueries) {
				const contextEmbedding =
					await defaultEmbedding.textToVector(contextQuery);
				const contextNodeResults = await vectorSearchNodes(
					database,
					defaultEmbedding,
					[contextQuery],
					nodeCandidateLimit,
					input.graphId,
				);
				const contextEdgeResults = await vectorSearchEdges(
					database,
					defaultEmbedding,
					[contextQuery],
					config.seed.edgeLimit,
					input.graphId,
				);

				const contextCandidates: EnhancedNode[] = contextNodeResults
					.filter((result) => result.similarity >= config.seed.nodeThreshold)
					.map((result) =>
						toEnhancedNode(result.item, result.similarity, 0, "seed"),
					);

				const contextSelected =
					mmrConfig.enabled && contextCandidates.length > config.seed.nodeLimit
						? applyMMR(
								contextCandidates,
								contextEmbedding,
								config.seed.nodeLimit,
								getMMRLambda(mmrConfig),
							)
						: contextCandidates.slice(0, config.seed.nodeLimit);

				contextSelected.forEach((node) => {
					const existing = contextSeedNodesMap.get(node.id);
					if (!existing || node.semanticScore > existing.semanticScore) {
						contextSeedNodesMap.set(node.id, node);
					}
				});

				contextEdgeResults
					.filter((result) => result.similarity >= config.seed.edgeThreshold)
					.map((result) =>
						toEnhancedEdge(result.item, result.similarity, 0, "seed"),
					)
					.forEach((edge) => {
						const existing = contextSeedEdgesMap.get(edge.id);
						if (!existing || edge.semanticScore > existing.semanticScore) {
							contextSeedEdgesMap.set(edge.id, edge);
						}
					});
			}

			logInfo(
				`[SMART_RETRIEVE] Phase 2: ${contextSeedNodesMap.size} context seed nodes, ${contextSeedEdgesMap.size} context seed edges`,
			);

			// Phase 3: Merge primary + context seeds
			const allNodes = new Map<string, EnhancedNode>();
			const allEdges = new Map<string, EnhancedEdge>();

			primarySeedNodes.forEach((node) => allNodes.set(node.id, node));
			primarySeedEdges.forEach((edge) => allEdges.set(edge.id, edge));
			contextSeedNodesMap.forEach((node, id) => {
				const existing = allNodes.get(id);
				if (!existing || node.semanticScore > existing.semanticScore) {
					allNodes.set(id, node);
				}
			});
			contextSeedEdgesMap.forEach((edge, id) => {
				const existing = allEdges.get(id);
				if (!existing || edge.semanticScore > existing.semanticScore) {
					allEdges.set(id, edge);
				}
			});

			logInfo(
				`[SMART_RETRIEVE] Phase 3: ${allNodes.size} merged seed nodes, ${allEdges.size} merged seed edges`,
			);

			// Phase 4: Smart Graph Expansion

			for (let level = 1; level <= config.expansion.maxLevels; level++) {
				const threshold = config.expansion.levelThresholds[level - 1] ?? 0.2;
				const currentLevelNodes = Array.from(allNodes.values()).filter(
					(n) => n.level === level - 1,
				);

				if (currentLevelNodes.length === 0) break;

				const nodeIds = currentLevelNodes.map((n) => n.id);

				const expansionResult = await getKnowledgeDatabase(database).query<{
					connectedEdges: Edge[];
					connectedNodes: Node[];
				}>(async ({ db, schema }) => {
					const connectedEdges: Edge[] = await db
						.select()
						.from(schema.edges)
						.where(
							and(
								or(
									inArray(schema.edges.sourceId, nodeIds),
									inArray(schema.edges.destinationId, nodeIds),
								),
								getScopedGraphWhere(
									{ graphId: input.graphId },
									schema.edges.graph,
								),
							),
						)
						.limit(config.expansion.maxEdgesPerLevel);

					const newNodeIds = new Set<string>();
					connectedEdges.forEach((edge) => {
						if (edge.sourceId && !nodeIds.includes(edge.sourceId)) {
							newNodeIds.add(edge.sourceId);
						}
						if (edge.destinationId && !nodeIds.includes(edge.destinationId)) {
							newNodeIds.add(edge.destinationId);
						}
					});

					const newNodesArray = Array.from(newNodeIds).slice(
						0,
						config.expansion.maxNodesPerLevel,
					);
					const connectedNodes =
						newNodesArray.length > 0
							? await db
									.select()
									.from(schema.nodes)
									.where(inArray(schema.nodes.id, newNodesArray))
							: [];

					return { connectedEdges, connectedNodes };
				});

				for (const node of expansionResult.connectedNodes) {
					const semanticScore = await calculateSemanticSimilarity(
						node,
						queryEmbedding,
					);
					if (semanticScore >= threshold && !allNodes.has(node.id)) {
						allNodes.set(
							node.id,
							toEnhancedNode(node, semanticScore, level, "expansion"),
						);
					}
				}

				expansionResult.connectedEdges.forEach((edge) => {
					if (edge.sourceId && edge.destinationId && !allEdges.has(edge.id)) {
						allEdges.set(
							edge.id,
							toEnhancedEdge(edge, 0.5, level, "expansion"),
						);
					}
				});
			}

			logInfo(
				`[SMART_RETRIEVE] Phase 4: ${allNodes.size} total nodes, ${allEdges.size} total edges`,
			);

			// Phase 5: Completeness Verification (merge components from query + contexts)
			const queryComponentsMap = new Map<string, QueryComponent>();
			[baseQuery, ...contextQueries].forEach((queryText) => {
				extractQueryComponents(
					queryText,
					config.completeness.minComponentLength,
				).forEach((component) => {
					if (!queryComponentsMap.has(component.text)) {
						queryComponentsMap.set(component.text, component);
					}
				});
			});
			const queryComponents = Array.from(queryComponentsMap.values());
			let currentNodes = Array.from(allNodes.values());
			let iterations = 0;

			while (iterations < config.completeness.maxIterations) {
				iterations++;
				const coverage = checkCoverage(currentNodes, queryComponents);
				if (coverage.total === 0) {
					break;
				}
				const coverageRatio = coverage.covered / coverage.total;

				if (coverageRatio >= config.completeness.threshold) break;

				const missingComponents = queryComponents.filter((c) => !c.covered);

				for (const component of missingComponents) {
					const gapResults = await vectorSearchNodes(
						database,
						defaultEmbedding,
						[component.text],
						config.completeness.gapFillingLimit,
						input.graphId,
					);

					gapResults.forEach((result) => {
						if (!allNodes.has(result.item.id)) {
							const node = toEnhancedNode(
								result.item,
								result.similarity,
								-1,
								"gap_filling",
							);
							node.coverageContribution = 1.0;
							allNodes.set(node.id, node);
							currentNodes.push(node);
						}
					});

					component.covered = true;
				}
			}

			logInfo(
				`[SMART_RETRIEVE] Phase 5: ${allNodes.size} nodes after gap filling`,
			);

			// Phase 6: Re-Ranking
			const nodes = Array.from(allNodes.values());
			const edges = Array.from(allEdges.values());
			const graphMetrics = calculateGraphMetrics(nodes, edges);

			const scoredNodes = nodes.map((node) => {
				const centrality = graphMetrics.centrality.get(node.id) ?? 0;
				const density = graphMetrics.density.get(node.id) ?? 0;

				const finalScore =
					node.semanticScore * config.ranking.semanticWeight +
					centrality * config.ranking.centralityWeight +
					density * config.ranking.densityWeight +
					node.coverageContribution * config.ranking.coverageWeight;

				return {
					...node,
					centralityScore: centrality,
					edgeDensity: density,
					finalScore,
				};
			});

			scoredNodes.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
			const topNodes = scoredNodes.slice(0, config.output.maxNodes);
			const topNodeIds = new Set(topNodes.map((n) => n.id));

			const filteredEdges = edges.filter(
				(edge) =>
					topNodeIds.has(edge.sourceId) || topNodeIds.has(edge.destinationId),
			);

			filteredEdges.sort((a, b) => b.semanticScore - a.semanticScore);
			const topEdges = filteredEdges.slice(0, config.output.maxEdges);

			logInfo(
				`[SMART_RETRIEVE] Phase 6: ${topNodes.length} final nodes, ${topEdges.length} final edges`,
			);

			// Phase 7: Post-Expansion (simplified)
			let finalNodes = topNodes;
			let finalEdges = topEdges;

			if (config.postExpansion.enabled) {
				const nodeMap = new Map(finalNodes.map((n) => [n.id, n]));
				const edgeMap = new Map(finalEdges.map((e) => [e.id, e]));

				// Find and connect standalone items
				for (let iter = 0; iter < config.postExpansion.maxIterations; iter++) {
					const standaloneNodeIds: string[] = [];
					const nodeConnections = new Map<string, number>();
					nodeMap.forEach((_, id) => nodeConnections.set(id, 0));

					edgeMap.forEach((edge) => {
						if (nodeMap.has(edge.sourceId) && nodeMap.has(edge.destinationId)) {
							nodeConnections.set(
								edge.sourceId,
								(nodeConnections.get(edge.sourceId) ?? 0) + 1,
							);
							nodeConnections.set(
								edge.destinationId,
								(nodeConnections.get(edge.destinationId) ?? 0) + 1,
							);
						}
					});

					nodeConnections.forEach((count, id) => {
						if (count === 0) standaloneNodeIds.push(id);
					});

					if (standaloneNodeIds.length === 0) break;

					const expansionResult = await getKnowledgeDatabase(database).query<{
						connectedEdges: Edge[];
						missingNodes: Node[];
					}>(async ({ db, schema }) => {
						const connectedEdges: Edge[] = await db
							.select()
							.from(schema.edges)
							.where(
								and(
									or(
										inArray(schema.edges.sourceId, standaloneNodeIds),
										inArray(schema.edges.destinationId, standaloneNodeIds),
									),
									getScopedGraphWhere(
										{ graphId: input.graphId },
										schema.edges.graph,
									),
								),
							)
							.limit(config.postExpansion.maxEdgesPerIteration);

						const missingNodeIds = new Set<string>();
						connectedEdges.forEach((edge) => {
							if (edge.sourceId && !nodeMap.has(edge.sourceId))
								missingNodeIds.add(edge.sourceId);
							if (edge.destinationId && !nodeMap.has(edge.destinationId))
								missingNodeIds.add(edge.destinationId);
						});

						const missingNodes =
							missingNodeIds.size > 0
								? await db
										.select()
										.from(schema.nodes)
										.where(inArray(schema.nodes.id, Array.from(missingNodeIds)))
								: [];

						return { connectedEdges, missingNodes };
					});

					let addedAny = false;
					expansionResult.missingNodes.forEach((node) => {
						if (!nodeMap.has(node.id)) {
							nodeMap.set(node.id, toEnhancedNode(node, 0.3, -1, "expansion"));
							addedAny = true;
						}
					});

					expansionResult.connectedEdges.forEach((edge) => {
						if (edge.sourceId && edge.destinationId && !edgeMap.has(edge.id)) {
							edgeMap.set(edge.id, toEnhancedEdge(edge, 0.4, -1, "expansion"));
							addedAny = true;
						}
					});

					if (!addedAny) break;
				}

				finalNodes = Array.from(nodeMap.values()).slice(
					0,
					config.output.maxNodes,
				);
				finalEdges = Array.from(edgeMap.values()).slice(
					0,
					config.output.maxEdges,
				);
			}

			logInfo(
				`[SMART_RETRIEVE] Complete: ${finalNodes.length} nodes, ${finalEdges.length} edges`,
			);

			// Convert to output format
			const relevantNodes: RelevantNode[] = finalNodes.map((node) => ({
				id: node.id,
				nodeType: node.nodeType || "default",
				name: node.name,
				summary: node.summary,
				attributes: node.attributes,
				relevanceScore: node.finalScore ?? node.semanticScore,
			}));

			const relevantEdges: RelevantEdge[] = finalEdges.map((edge) => ({
				id: edge.id,
				sourceId: edge.sourceId,
				destinationId: edge.destinationId,
				edgeType: edge.edgeType,
				factText: edge.factText,
				attributes: edge.attributes,
				relevanceScore: edge.finalScore ?? edge.semanticScore,
			}));

			return {
				output: {
					relevantNodes,
					relevantEdges,
					extractedEntities: queryComponents.map((c) => c.text),
					queryIntent: "factual",
					next: "build_context",
				},
			};
		} catch (error) {
			logError("[SMART_RETRIEVE] Retrieval failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Smart Retrieval Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Smart retrieval failed",
					],
				},
			};
		}
	},
});

type SmartRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createSmartRetrieveStep: StepFactoryFromSpec<SmartRetrieveSpec> = (
	services: SmartRetrieveServices,
	config?: Partial<SmartRetrievalConfig>,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createSmartRetrieveStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: SmartRetrieveSpec;
	}
}
