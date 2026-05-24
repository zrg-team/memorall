import { getKnowledgeDatabase } from "../../../interfaces/knowledge";
import { eq, or } from "drizzle-orm";
import { logInfo, logError, logWarn } from "../../../interfaces/logger";
import type { Node, NewNode, Source } from "../../../interfaces/knowledge";
import type { Edge, NewEdge } from "../../../interfaces/knowledge";
import type { IEmbeddingService } from "../../../interfaces/embedding";
import { getCurrentEmbeddingFields } from "../../../utils/embedding-size-config";

import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "knowledge-database-save" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

/** Entity that has been resolved (merged with existing or assigned new ID) */
export interface ResolvedEntity {
	uuid: string;
	originalName?: string;
	finalName: string;
	nodeType: string;
	summary?: string | null;
	attributes?: unknown;
	isExisting: boolean;
	existingId?: string;
}

/** Fact with temporal information */
export interface EnrichedFact {
	uuid: string;
	sourceEntityId: string;
	destinationEntityId: string;
	relationType: string;
	factText: string;
	attributes?: unknown;
	isExisting: boolean;
	existingId?: string;
	temporal?: {
		validAt?: string;
		invalidAt?: string;
	};
}

/** Existing node from database */
export interface ExistingNode {
	id: string;
	name: string;
	nodeType: string;
	summary?: string | null;
	attributes?: unknown;
}

/** Input for database save step */
export interface KnowledgeDatabaseSaveInput {
	sourceId?: string;
	graphId?: string;
	url?: string;
	title?: string;
	resolvedEntities: ResolvedEntity[];
	resolvedFacts?: EnrichedFact[];
	enrichedFacts?: EnrichedFact[];
	existingNodes?: ExistingNode[];
}

export type KnowledgeDatabaseSaveServices = Pick<
	AllServices,
	"database" | "embedding"
>;

type SourceSelectType = Source;

/** Output from database save step */
export interface KnowledgeDatabaseSaveOutput {
	createdSource?: SourceSelectType;
	createdNodes?: Partial<Node>[];
	createdEdges?: Partial<Edge>[];
	processingStage?: string;
	response?: string;
	errors?: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function safeTextToVector(
	embeddingService: IEmbeddingService | undefined,
	text: string,
	context: string,
): Promise<number[] | null> {
	try {
		if (!text || text.trim().length === 0) return null;
		if (!embeddingService) return null;
		const defaultEmbedding = await embeddingService.get("default");
		if (!defaultEmbedding || !defaultEmbedding.isReady()) return null;
		return await defaultEmbedding.textToVector(text);
	} catch (error) {
		logError(`[${context}] Embedding failed, continuing without vector:`, {
			error: error instanceof Error ? error.message : String(error),
			textLength: text.length,
		});
		return null;
	}
}

function normalizeString(str: string): string {
	return str
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[^\w\s-]/g, "")
		.replace(/\s/g, "_");
}

function levenshteinDistance(str1: string, str2: string): number {
	const matrix = Array(str2.length + 1)
		.fill(null)
		.map(() => Array(str1.length + 1).fill(null));

	for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
	for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

	for (let j = 1; j <= str2.length; j++) {
		for (let i = 1; i <= str1.length; i++) {
			const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
			matrix[j][i] = Math.min(
				matrix[j][i - 1] + 1,
				matrix[j - 1][i] + 1,
				matrix[j - 1][i - 1] + indicator,
			);
		}
	}

	return matrix[str2.length][str1.length];
}

function isFuzzyMatch(entityName: string, nodeName: string): boolean {
	const normalizedEntity = normalizeString(entityName);
	const normalizedNode = normalizeString(nodeName);

	if (levenshteinDistance(normalizedEntity, normalizedNode) <= 2) {
		return true;
	}

	if (
		normalizedEntity.includes(normalizedNode) ||
		normalizedNode.includes(normalizedEntity)
	) {
		return true;
	}

	const words1 = entityName
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);
	const words2 = nodeName
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 2);

	if (words1.length > 0 && words2.length > 0) {
		const commonWords = words1.filter((w1) =>
			words2.some((w2) => w1.includes(w2) || w2.includes(w1)),
		);
		return commonWords.length >= Math.min(words1.length, words2.length) * 0.6;
	}

	return false;
}

function findNodeByMultipleStrategies(
	entity: ResolvedEntity,
	nodeNameToId: Map<string, string>,
	createdNodes: Node[],
): string | null {
	const normalizedEntityName = normalizeString(entity.finalName);

	// Strategy 1: Exact name match
	let nodeId = nodeNameToId.get(entity.finalName);
	if (nodeId) return nodeId;

	// Strategy 2: Normalized name match
	for (const [name, id] of nodeNameToId.entries()) {
		if (normalizeString(name) === normalizedEntityName) {
			return id;
		}
	}

	// Strategy 3: Direct node search with multiple criteria
	const matchingNode = createdNodes.find((node) => {
		if (!node.name) return false;
		if (node.name === entity.finalName) return true;
		if (normalizeString(node.name) === normalizedEntityName) return true;
		return isFuzzyMatch(entity.finalName, node.name);
	});

	return matchingNode ? String(matchingNode.id) : null;
}

function getNodeId(
	entity: ResolvedEntity,
	nodeNameToId: Map<string, string>,
	createdNodes: Node[],
): string | null {
	if (entity.isExisting && entity.existingId) {
		return String(entity.existingId);
	}

	let nodeId = findNodeByMultipleStrategies(entity, nodeNameToId, createdNodes);

	if (!nodeId) {
		logError(
			`[DATABASE_SAVE] Could not find created node for entity: ${entity.finalName}`,
			{
				entityUuid: entity.uuid,
				finalName: entity.finalName,
				nodeType: entity.nodeType,
				availableNodes: createdNodes.map((n) => ({ id: n.id, name: n.name })),
				availableNames: Array.from(nodeNameToId.keys()),
			},
		);
		return null;
	}

	return nodeId;
}

// ============================================================================
// NODE CREATION
// ============================================================================

async function createNodes(
	input: KnowledgeDatabaseSaveInput,
	graphId: string,
	createdSource: SourceSelectType,
	services: KnowledgeDatabaseSaveServices,
): Promise<Node[]> {
	const createdNodes: Node[] = [];
	const newEntities = input.resolvedEntities.filter((e) => !e.isExisting);
	const skippedNodes: ResolvedEntity[] = [];

	return await getKnowledgeDatabase(services.database).query(
		async ({ db, schema }) => {
			for (const entity of newEntities) {
				try {
					const nodeData: NewNode = {
						nodeType: entity.nodeType,
						name: entity.finalName,
						summary: entity.summary,
						attributes: (entity.attributes || {}) as Record<string, unknown>,
						graph: graphId,
					};

					const nameEmbedding = await safeTextToVector(
						services.embedding,
						entity.finalName,
						`NODE_EMBEDDING:${entity.finalName.substring(0, 50)}`,
					);
					if (nameEmbedding) {
						const fields = await getCurrentEmbeddingFields();
						(nodeData as Record<string, unknown>)[fields.nameEmbedding] =
							nameEmbedding;
					}

					const [createdNode] = await db
						.insert(schema.nodes)
						.values(nodeData)
						.returning();

					logInfo(
						`[DATABASE_SAVE] Created node with ID: ${createdNode.id} for entity: ${entity.finalName}`,
					);
					createdNodes.push(createdNode);

					await db.insert(schema.sourceNodes).values({
						sourceId: createdSource.id,
						nodeId: createdNode.id,
						relation: "MENTIONED_IN",
						graph: graphId,
					});
				} catch (error) {
					skippedNodes.push(entity);
					logError(
						`[DATABASE_SAVE] Failed to create node for entity: ${entity.finalName}`,
						error,
					);
				}
			}

			if (skippedNodes.length > 0) {
				logWarn("[DATABASE_SAVE] Skipped nodes that could not be stored:", {
					count: skippedNodes.length,
					skippedNodes: skippedNodes.map((entity) => ({
						name: entity.finalName,
						type: entity.nodeType,
						uuid: entity.uuid,
					})),
				});
			}

			return createdNodes;
		},
	);
}

// ============================================================================
// EDGE CREATION
// ============================================================================

async function createEdges(
	input: KnowledgeDatabaseSaveInput,
	createdNodes: Node[],
	graphId: string,
	createdSource: SourceSelectType,
	services: KnowledgeDatabaseSaveServices,
): Promise<Edge[]> {
	return await getKnowledgeDatabase(services.database).query(
		async ({ db, schema }) => {
			const createdEdges: Edge[] = [];

			const factsToProcess =
				input.enrichedFacts && input.enrichedFacts.length > 0
					? input.enrichedFacts.filter((f) => !f.isExisting)
					: (input.resolvedFacts || [])
							.filter((f) => !f.isExisting)
							.map((fact) => ({
								...fact,
								temporal: { validAt: undefined, invalidAt: undefined },
							}));

			logInfo(`[DATABASE_SAVE] Processing facts:`, {
				enrichedFactsCount: input.enrichedFacts?.length || 0,
				resolvedFactsCount: input.resolvedFacts?.length || 0,
				factsToProcessCount: factsToProcess.length,
			});

			const skippedEdges: EnrichedFact[] = [];

			// Build lookup map for node names to IDs
			const nodeNameToId = new Map<string, string>();

			for (const node of createdNodes) {
				if (node.name && node.id) {
					nodeNameToId.set(node.name, String(node.id));
				}
			}

			for (const node of input.existingNodes || []) {
				if (node.name && node.id) {
					nodeNameToId.set(node.name, String(node.id));
				}
			}

			logInfo(
				`[DATABASE_SAVE] Built nodeNameToId map with ${nodeNameToId.size} entries`,
			);

			for (const fact of factsToProcess) {
				try {
					const sourceEntity = input.resolvedEntities.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = input.resolvedEntities.find(
						(e) => e.uuid === fact.destinationEntityId,
					);

					if (!sourceEntity || !destEntity) {
						skippedEdges.push(fact);
						logError(
							`[DATABASE_SAVE] Could not find entities for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
						);
						continue;
					}

					const allNodes = [
						...createdNodes,
						...(input.existingNodes || []),
					] as Node[];
					const sourceNodeId = getNodeId(sourceEntity, nodeNameToId, allNodes);
					const destNodeId = getNodeId(destEntity, nodeNameToId, allNodes);

					if (!sourceNodeId || !destNodeId) {
						skippedEdges.push(fact);
						logError(
							`[DATABASE_SAVE] Could not resolve node IDs for: ${sourceEntity.finalName} -> ${destEntity.finalName}`,
						);
						continue;
					}

					// Validate UUID format
					const uuidRegex =
						/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
					if (!uuidRegex.test(sourceNodeId) || !uuidRegex.test(destNodeId)) {
						skippedEdges.push(fact);
						logError(
							`[DATABASE_SAVE] Invalid UUID format: source=${sourceNodeId}, dest=${destNodeId}`,
						);
						continue;
					}

					// Validate node existence
					const nodeExistenceCheck = await db
						.select({ id: schema.nodes.id })
						.from(schema.nodes)
						.where(
							or(
								eq(schema.nodes.id, sourceNodeId),
								eq(schema.nodes.id, destNodeId),
							),
						);

					const existingIds = new Set(
						nodeExistenceCheck.map((n: { id: string }) => n.id),
					);

					if (!existingIds.has(sourceNodeId) || !existingIds.has(destNodeId)) {
						skippedEdges.push(fact);
						logError(`[DATABASE_SAVE] Node(s) do not exist in database`);
						continue;
					}

					const edgeData: NewEdge = {
						sourceId: sourceNodeId,
						destinationId: destNodeId,
						edgeType: fact.relationType,
						factText: fact.factText,
						validAt: fact.temporal?.validAt
							? new Date(fact.temporal.validAt)
							: undefined,
						invalidAt: fact.temporal?.invalidAt
							? new Date(fact.temporal.invalidAt)
							: undefined,
						recordedAt: new Date(),
						attributes: (fact.attributes || {}) as Record<string, unknown>,
						graph: graphId,
					};

					// Generate embeddings
					const factEmbedding = await safeTextToVector(
						services.embedding,
						fact.factText,
						`FACT_EMBEDDING:${fact.factText.substring(0, 50)}`,
					);
					const typeEmbedding = await safeTextToVector(
						services.embedding,
						fact.relationType,
						`TYPE_EMBEDDING:${fact.relationType}`,
					);

					if (factEmbedding || typeEmbedding) {
						const fields = await getCurrentEmbeddingFields();
						if (factEmbedding) {
							(edgeData as Record<string, unknown>)[fields.factEmbedding] =
								factEmbedding;
						}
						if (typeEmbedding) {
							(edgeData as Record<string, unknown>)[fields.typeEmbedding] =
								typeEmbedding;
						}
					}

					try {
						const [edge] = await db
							.insert(schema.edges)
							.values(edgeData)
							.returning();

						createdEdges.push(edge);

						await db.insert(schema.sourceEdges).values({
							sourceId: createdSource.id,
							edgeId: edge.id,
							relation: "EXTRACTED_FROM",
							linkWeight: 1.0,
							graph: graphId,
						});
					} catch (edgeError) {
						skippedEdges.push(fact);
						logError(`[DATABASE_SAVE] Failed to create edge`, edgeError);
					}
				} catch (error) {
					skippedEdges.push(fact);
					logError(`[DATABASE_SAVE] Unexpected error processing fact`, error);
				}
			}

			if (skippedEdges.length > 0) {
				logWarn("[DATABASE_SAVE] Skipped edges:", {
					count: skippedEdges.length,
					skippedEdges: skippedEdges.map((fact) => ({
						relationType: fact.relationType,
						factText: fact.factText,
					})),
				});
			}

			return createdEdges;
		},
	);
}

// ============================================================================
// STEP DEFINITION
// ============================================================================

const definition = defineStep<
	KnowledgeDatabaseSaveInput,
	KnowledgeDatabaseSaveOutput,
	KnowledgeDatabaseSaveServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			const graphId = input.graphId?.trim() || "default";

			logInfo("[DATABASE_SAVE] Saving knowledge graph to database:", {
				url: input.url,
				title: input.title,
				sourceId: input.sourceId,
				graphId,
			});

			const databaseService = services.database;
			if (!databaseService) {
				throw new Error("Database service not available");
			}

			if (!input.sourceId) {
				throw new Error("Invalid or missing sourceId");
			}

			// Get source from database
			const createdSource = await getKnowledgeDatabase(databaseService).query(
				async ({ db, schema }) => {
					const sources = await db
						.select()
						.from(schema.sources)
						.where(eq(schema.sources.id, input.sourceId || ""))
						.limit(1);

					if (!sources || sources.length === 0) {
						throw new Error(`Source not found with id: ${input.sourceId}`);
					}

					return sources[0];
				},
			);

			logInfo(`[DATABASE_SAVE] Using source: ${createdSource.id}`);

			// Create nodes
			const newEntityCount = input.resolvedEntities.filter(
				(e) => !e.isExisting,
			).length;
			logInfo(`[DATABASE_SAVE] Creating ${newEntityCount} nodes...`);
			const createdNodes = await createNodes(
				input,
				graphId,
				createdSource,
				services,
			);
			logInfo(`[DATABASE_SAVE] ${createdNodes.length} nodes created`);

			// Create edges
			const factsToProcess =
				input.enrichedFacts && input.enrichedFacts.length > 0
					? input.enrichedFacts.filter((f) => !f.isExisting).length
					: (input.resolvedFacts || []).filter((f) => !f.isExisting).length;
			logInfo(`[DATABASE_SAVE] Creating ${factsToProcess} edges...`);
			const createdEdges = await createEdges(
				input,
				createdNodes,
				graphId,
				createdSource,
				services,
			);
			logInfo(`[DATABASE_SAVE] ${createdEdges.length} edges created`);

			logInfo(
				`[DATABASE_SAVE] Successfully saved ${createdNodes.length} nodes and ${createdEdges.length} edges`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Knowledge Graph Saved",
					description: `Successfully created knowledge graph with ${createdNodes.length} nodes and ${createdEdges.length} edges`,
					metadata: {
						sourceId: createdSource.id,
						nodeCount: createdNodes.length,
						edgeCount: createdEdges.length,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					createdSource,
					createdNodes,
					createdEdges,
					processingStage: "completed",
					response: `Knowledge graph creation completed. Created ${createdNodes.length} new nodes and ${createdEdges.length} new edges from "${input.title}".`,
				},
			};
		} catch (error) {
			logError("[DATABASE_SAVE] Error:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Database Save Failed",
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
							: "Failed to save to database",
					],
					response:
						"Knowledge graph creation failed during database save operation.",
				},
			};
		}
	},
});

type KnowledgeDatabaseSaveSpec = StepSpecFromDefinition<typeof definition>;

export const createDatabaseSaveStep: StepFactoryFromSpec<
	KnowledgeDatabaseSaveSpec
> = (services: KnowledgeDatabaseSaveServices) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createDatabaseSaveStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: KnowledgeDatabaseSaveSpec;
	}
}
