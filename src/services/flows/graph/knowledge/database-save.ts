import type {
	KnowledgeGraphState,
	ResolvedEntity,
	EnrichedFact,
} from "./state";
import type { AllServices } from "../../interfaces/tool";
import { logInfo, logError, logWarn } from "@/utils/logger";
import type { NewSource } from "@/services/database/entities/sources";
import type { Node, NewNode } from "@/services/database/entities/nodes";
import type { Edge, NewEdge } from "@/services/database/entities/edges";
import type { IEmbeddingService } from "@/services/embedding/interfaces/embedding-service.interface";
import { getDB, schema } from "@/services/database/db";
import type { InferSelectModel } from "drizzle-orm";
import { eq, or } from "drizzle-orm";

// Inferred database types
type DatabaseInstance = ReturnType<typeof getDB>;
type SchemaType = typeof schema;
type SourceSelectType = InferSelectModel<typeof schema.sources>;

// Database transaction context type
type DatabaseContext = {
	db: DatabaseInstance;
	schema: SchemaType;
};

// Database operation result types
type DatabaseSaveResult = {
	createdSource: SourceSelectType;
	createdNodes: Partial<Node>[];
	createdEdges: Partial<Edge>[];
};

// Safe embedding generation that continues storage even on failure
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

export class DatabaseSaveFlow {
	constructor(private services: AllServices) {}

	// Helper function to determine the graph field value based on topicId
	private getGraphValue(state: KnowledgeGraphState): string {
		if (state.topicId && state.topicId.trim().length > 0) {
			return `topic_${state.topicId.trim()}`;
		}
		return "";
	}

	async saveToDatabaseNode(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			logInfo("[SAVE_TO_DATABASE] Saving knowledge graph to database:", {
				hasPageId: !!state.pageId,
				pageId: state.pageId,
				url: state.url,
				title: state.title,
				processingStage: state.processingStage,
			});

			const databaseService = this.services.database;
			if (!databaseService) {
				throw new Error("Database service not available");
			}

			const embeddingService = this.services.embedding;

			// Validate required fields
			if (
				!state.pageId ||
				typeof state.pageId !== "string" ||
				state.pageId.trim().length === 0
			) {
				throw new Error(
					"Invalid or missing pageId - cannot create source without valid target ID",
				);
			}

			if (
				!state.title ||
				typeof state.title !== "string" ||
				state.title.trim().length === 0
			) {
				throw new Error(
					"Invalid or missing title - cannot create source without name",
				);
			}

			// Create source first
			logInfo("[SAVE_TO_DATABASE] Creating source...");
			const createdSource = await databaseService.use(
				async ({ db, schema }) => {
					return await this.createSource(state, { db, schema });
				},
			);
			logInfo(
				`[SAVE_TO_DATABASE] Source created successfully: ${createdSource.id}`,
			);

			// Create new nodes
			logInfo(
				`[SAVE_TO_DATABASE] Creating ${state.resolvedEntities?.filter((e) => !e.isExisting).length || 0} nodes...`,
			);
			const createdNodes = await databaseService.use(async ({ db, schema }) => {
				return await this.createNodes(state, createdSource, embeddingService, {
					db,
					schema,
				});
			});
			logInfo(
				`[SAVE_TO_DATABASE] ${createdNodes.length} nodes created successfully`,
			);

			// Create new edges
			const factsToProcess =
				state.enrichedFacts?.length > 0
					? state.enrichedFacts.filter((f) => !f.isExisting).length
					: (state.resolvedFacts || []).filter((f) => !f.isExisting).length;
			logInfo(`[SAVE_TO_DATABASE] Creating ${factsToProcess} edges...`);
			const createdEdges = await databaseService.use(async ({ db, schema }) => {
				return await this.createEdges(
					state,
					createdNodes,
					createdSource,
					embeddingService,
					{ db, schema },
				);
			});
			logInfo(
				`[SAVE_TO_DATABASE] ${createdEdges.length} edges created successfully`,
			);

			const result = { createdSource, createdNodes, createdEdges };

			logInfo(
				`[SAVE_TO_DATABASE] Successfully saved ${result.createdNodes.length} nodes and ${result.createdEdges.length} edges`,
			);

			// Log success details
			this.logSaveResults(state, result);

			return {
				createdSource: result.createdSource,
				createdNodes: result.createdNodes,
				createdEdges: result.createdEdges,
				processingStage: "completed",
				finalMessage: `Knowledge graph creation completed. Created ${result.createdNodes.length} new nodes and ${result.createdEdges.length} new edges from "${state.title}".`,
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Knowledge Graph Saved",
						description: `Successfully created knowledge graph with ${result.createdNodes.length} nodes and ${result.createdEdges.length} edges`,
						metadata: {
							sourceId: result.createdSource.id,
							nodeCount: result.createdNodes.length,
							edgeCount: result.createdEdges.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[SAVE_TO_DATABASE] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Failed to save to database",
				],
				finalMessage:
					"Knowledge graph creation failed during database save operation.",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Database Save Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}

	private async createSource(
		state: KnowledgeGraphState,
		{ db, schema }: DatabaseContext,
	): Promise<SourceSelectType> {
		logInfo("💾 Creating source with polymorphic relation", {
			targetType: "remembered_pages",
			targetId: state.pageId,
			hasPageId: !!state.pageId,
			title: state.title,
		});

		const sourceData: NewSource = {
			targetType: "remembered_pages",
			targetId: state.pageId!.trim(),
			name: state.title!.trim(),
			metadata: {
				...(state.metadata || {}),
				topicId: state.topicId, // Include topic information in source metadata
			},
			referenceTime: new Date(state.referenceTimestamp),
			weight: 1.0,
			graph: this.getGraphValue(state),
		};

		const [createdSource] = await db
			.insert(schema.sources)
			.values(sourceData)
			.returning();

		return createdSource;
	}

	private async createNodes(
		state: KnowledgeGraphState,
		createdSource: SourceSelectType,
		embeddingService: IEmbeddingService | undefined,
		{ db, schema }: DatabaseContext,
	): Promise<Node[]> {
		const createdNodes: Node[] = [];
		const newEntities = state.resolvedEntities.filter((e) => !e.isExisting);
		const skippedNodes: ResolvedEntity[] = [];

		for (const entity of newEntities) {
			try {
				const nodeData: NewNode = {
					nodeType: entity.nodeType,
					name: entity.finalName,
					summary: entity.summary,
					attributes: entity.attributes || {},
					graph: this.getGraphValue(state),
				};

				// Generate embedding for node name
				const nameEmbedding = await safeTextToVector(
					embeddingService,
					entity.finalName,
					`NODE_EMBEDDING:${entity.finalName.substring(0, 50)}`,
				);
				if (nameEmbedding) {
					nodeData.nameEmbedding = nameEmbedding;
				}

				const [createdNode] = await db
					.insert(schema.nodes)
					.values(nodeData)
					.returning();

				logInfo(
					`[SAVE_TO_DATABASE] Created node with ID: ${createdNode.id} for entity: ${entity.finalName}`,
				);
				createdNodes.push(createdNode);

				// Create source-node relationship
				await db.insert(schema.sourceNodes).values({
					sourceId: createdSource.id,
					nodeId: createdNode.id,
					relation: "MENTIONED_IN",
					graph: this.getGraphValue(state),
				});
			} catch (error) {
				skippedNodes.push(entity);
				logError(
					`[SAVE_TO_DATABASE] Failed to create node for entity: ${entity.finalName}`,
					error,
				);
			}
		}

		// Log warning for skipped nodes
		if (skippedNodes.length > 0) {
			logWarn("[SAVE_TO_DATABASE] Skipped nodes that could not be stored:", {
				count: skippedNodes.length,
				skippedNodes: skippedNodes.map((entity) => ({
					name: entity.finalName,
					type: entity.nodeType,
					uuid: entity.uuid,
				})),
			});
		}

		return createdNodes;
	}

	private async createEdges(
		state: KnowledgeGraphState,
		createdNodes: Node[],
		createdSource: SourceSelectType,
		embeddingService: IEmbeddingService | undefined,
		{ db, schema }: DatabaseContext,
	): Promise<Edge[]> {
		const createdEdges: Edge[] = [];

		// Handle both enrichedFacts (with temporal extraction) and resolvedFacts (without temporal extraction)
		const factsToProcess =
			state.enrichedFacts?.length > 0
				? state.enrichedFacts.filter((f) => !f.isExisting)
				: (state.resolvedFacts || [])
						.filter((f) => !f.isExisting)
						.map((fact) => ({
							...fact,
							temporal: { validAt: undefined, invalidAt: undefined },
						}));

		logInfo(`[SAVE_TO_DATABASE] Processing facts:`, {
			enrichedFactsCount: state.enrichedFacts?.length || 0,
			resolvedFactsCount: state.resolvedFacts?.length || 0,
			factsToProcessCount: factsToProcess.length,
			usingEnrichedFacts: state.enrichedFacts?.length > 0,
		});

		const skippedEdges: (EnrichedFact | (typeof factsToProcess)[0])[] = [];

		// Create a lookup map for better performance including both created nodes AND existing nodes
		const nodeNameToId = new Map<string, string>();

		// Add newly created nodes
		for (const node of createdNodes) {
			if (node.name && node.id) {
				const nodeIdString = String(node.id);
				nodeNameToId.set(node.name, nodeIdString);
			}
		}

		// Add existing nodes from state.existingNodes
		for (const node of state.existingNodes || []) {
			if (node.name && node.id) {
				const nodeIdString = String(node.id);
				nodeNameToId.set(node.name, nodeIdString);
			}
		}

		logInfo(
			`[SAVE_TO_DATABASE] Built nodeNameToId map with ${nodeNameToId.size} entries:`,
			{
				entries: Array.from(nodeNameToId.entries()),
			},
		);

		for (const fact of factsToProcess) {
			try {
				// Map entity UUIDs to actual node IDs
				const sourceEntity = state.resolvedEntities.find(
					(e) => e.uuid === fact.sourceEntityId,
				);
				const destEntity = state.resolvedEntities.find(
					(e) => e.uuid === fact.destinationEntityId,
				);

				if (!sourceEntity || !destEntity) {
					skippedEdges.push(fact);
					logError(
						`[SAVE_TO_DATABASE] Could not find entities for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
						{
							sourceEntityId: fact.sourceEntityId,
							destinationEntityId: fact.destinationEntityId,
							availableEntityUuids: state.resolvedEntities.map((e) => ({
								uuid: e.uuid,
								name: e.finalName,
							})),
							factRelationType: fact.relationType,
							factText: fact.factText,
						},
					);
					continue;
				}

				logInfo(
					`[SAVE_TO_DATABASE] Processing fact: ${sourceEntity.finalName} -> ${destEntity.finalName} (${fact.relationType})`,
					{
						sourceEntityUuid: sourceEntity.uuid,
						destEntityUuid: destEntity.uuid,
						sourceEntityName: sourceEntity.finalName,
						destEntityName: destEntity.finalName,
					},
				);

				// Get actual node IDs with consistent string conversion
				const allNodes = [...createdNodes, ...(state.existingNodes || [])];
				const sourceNodeId = this.getNodeId(
					sourceEntity,
					nodeNameToId,
					allNodes,
				);
				const destNodeId = this.getNodeId(destEntity, nodeNameToId, allNodes);

				logInfo(`[SAVE_TO_DATABASE] Node ID resolution results:`, {
					sourceEntity: {
						name: sourceEntity.finalName,
						uuid: sourceEntity.uuid,
						isExisting: sourceEntity.isExisting,
						existingId: sourceEntity.existingId,
						resolvedNodeId: sourceNodeId,
					},
					destEntity: {
						name: destEntity.finalName,
						uuid: destEntity.uuid,
						isExisting: destEntity.isExisting,
						existingId: destEntity.existingId,
						resolvedNodeId: destNodeId,
					},
				});

				if (!sourceNodeId || !destNodeId) {
					skippedEdges.push(fact);
					logError(
						`[SAVE_TO_DATABASE] Could not resolve node IDs for entities: ${sourceEntity.finalName} -> ${destEntity.finalName}`,
						{
							sourceEntity: sourceEntity.finalName,
							destEntity: destEntity.finalName,
							sourceNodeId,
							destNodeId,
							sourceEntityIsExisting: sourceEntity.isExisting,
							destEntityIsExisting: destEntity.isExisting,
							sourceEntityExistingId: sourceEntity.existingId,
							destEntityExistingId: destEntity.existingId,
						},
					);
					continue;
				}

				// Validate that we have valid UUID strings
				const uuidRegex =
					/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
				if (!uuidRegex.test(sourceNodeId) || !uuidRegex.test(destNodeId)) {
					skippedEdges.push(fact);
					logError(
						`[SAVE_TO_DATABASE] Invalid UUID format for node IDs: source=${sourceNodeId}, dest=${destNodeId}`,
						{
							sourceEntity: sourceEntity.finalName,
							destEntity: destEntity.finalName,
							sourceNodeId,
							destNodeId,
						},
					);
					continue;
				}

				// Validate that both node IDs exist in the database
				try {
					const nodeExistenceCheck = await db
						.select({ id: schema.nodes.id })
						.from(schema.nodes)
						.where(
							or(
								eq(schema.nodes.id, sourceNodeId),
								eq(schema.nodes.id, destNodeId),
							),
						);

					const existingIds = new Set(nodeExistenceCheck.map((n) => n.id));

					if (!existingIds.has(sourceNodeId)) {
						skippedEdges.push(fact);
						logError(
							`[SAVE_TO_DATABASE] Source node ID does not exist: ${sourceNodeId}`,
							{
								sourceEntity: sourceEntity.finalName,
								destEntity: destEntity.finalName,
								sourceNodeId,
								destNodeId,
							},
						);
						continue;
					}

					if (!existingIds.has(destNodeId)) {
						skippedEdges.push(fact);
						logError(
							`[SAVE_TO_DATABASE] Destination node ID does not exist: ${destNodeId}`,
							{
								sourceEntity: sourceEntity.finalName,
								destEntity: destEntity.finalName,
								sourceNodeId,
								destNodeId,
							},
						);
						continue;
					}
				} catch (nodeCheckError) {
					skippedEdges.push(fact);
					logError(
						`[SAVE_TO_DATABASE] Failed to validate node existence for edge: ${sourceNodeId} -> ${destNodeId}`,
						nodeCheckError,
					);
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
					attributes: fact.attributes || {},
					graph: this.getGraphValue(state),
				};

				// Generate embeddings for fact
				const factEmbedding = await safeTextToVector(
					embeddingService,
					fact.factText,
					`FACT_EMBEDDING:${fact.factText.substring(0, 50)}`,
				);
				const typeEmbedding = await safeTextToVector(
					embeddingService,
					fact.relationType,
					`TYPE_EMBEDDING:${fact.relationType}`,
				);

				if (factEmbedding) {
					edgeData.factEmbedding = factEmbedding;
				}
				if (typeEmbedding) {
					edgeData.typeEmbedding = typeEmbedding;
				}

				let createdEdge: Edge;
				try {
					const [edge] = await db
						.insert(schema.edges)
						.values(edgeData)
						.returning();
					createdEdge = edge;
				} catch (edgeError) {
					skippedEdges.push(fact);

					// Extract more detailed error information
					let errorDetails = {
						error:
							edgeError instanceof Error
								? edgeError.message
								: String(edgeError),
						sourceNodeId,
						destNodeId,
						edgeData: {
							sourceId: edgeData.sourceId,
							destinationId: edgeData.destinationId,
							edgeType: edgeData.edgeType,
							factText: edgeData.factText,
							graph: edgeData.graph,
						},
						edgeError,
					};

					logError(
						`[SAVE_TO_DATABASE] Failed to create edge for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
						errorDetails,
					);
					continue; // Continue with next edge instead of failing the entire operation
				}

				createdEdges.push(createdEdge);

				// Create source-edge relationship
				try {
					await db.insert(schema.sourceEdges).values({
						sourceId: createdSource.id,
						edgeId: createdEdge.id,
						relation: "EXTRACTED_FROM",
						linkWeight: 1.0,
						graph: this.getGraphValue(state),
					});
				} catch (sourceEdgeError) {
					logError(
						`[SAVE_TO_DATABASE] Failed to create source-edge relationship for edge ${createdEdge.id}`,
						sourceEdgeError,
					);
					// Don't skip the edge since it was already created successfully
				}
			} catch (error) {
				skippedEdges.push(fact);
				logError(
					`[SAVE_TO_DATABASE] Unexpected error while processing fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
					error,
				);
				continue; // Continue with next edge instead of failing the entire operation
			}
		}

		// Log warning for skipped edges
		if (skippedEdges.length > 0) {
			logWarn("[SAVE_TO_DATABASE] Skipped edges that could not be stored:", {
				count: skippedEdges.length,
				skippedEdges: skippedEdges.map((fact) => ({
					relationType: fact.relationType,
					factText: fact.factText,
					sourceEntityId: fact.sourceEntityId,
					destinationEntityId: fact.destinationEntityId,
				})),
			});
		}

		return createdEdges;
	}

	private getNodeId(
		entity: ResolvedEntity,
		nodeNameToId: Map<string, string>,
		createdNodes: Node[],
	): string | null {
		if (entity.isExisting && entity.existingId) {
			// Ensure consistent string format for existing nodes
			return String(entity.existingId);
		}

		// Multiple fallback strategies for newly created nodes
		let nodeId = this.findNodeByMultipleStrategies(
			entity,
			nodeNameToId,
			createdNodes,
		);

		if (!nodeId) {
			logError(
				`[SAVE_TO_DATABASE] Could not find created node for entity: ${entity.finalName}`,
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

	private findNodeByMultipleStrategies(
		entity: ResolvedEntity,
		nodeNameToId: Map<string, string>,
		createdNodes: Node[],
	): string | null {
		const normalizedEntityName = this.normalizeString(entity.finalName);

		// Strategy 1: Exact name match
		let nodeId = nodeNameToId.get(entity.finalName);
		if (nodeId) return nodeId;

		// Strategy 2: Normalized name match
		for (const [name, id] of nodeNameToId.entries()) {
			if (this.normalizeString(name) === normalizedEntityName) {
				return id;
			}
		}

		// Strategy 3: Direct node search with multiple criteria
		const matchingNode = createdNodes.find((node) => {
			if (!node.name) return false;

			// Exact match
			if (node.name === entity.finalName) return true;

			// Normalized match
			if (this.normalizeString(node.name) === normalizedEntityName) return true;

			// Type-specific fuzzy matching
			return this.isFuzzyMatch(entity.finalName, node.name, entity.nodeType);
		});

		return matchingNode ? String(matchingNode.id) : null;
	}

	private normalizeString(str: string): string {
		return str
			.toLowerCase()
			.trim()
			.replace(/\s+/g, " ") // Normalize whitespace
			.replace(/[^\w\s-]/g, "") // Remove special chars except word chars, spaces, hyphens
			.replace(/\s/g, "_"); // Replace spaces with underscores
	}

	private isFuzzyMatch(
		entityName: string,
		nodeName: string,
		nodeType: string,
	): boolean {
		const normalizedEntity = this.normalizeString(entityName);
		const normalizedNode = this.normalizeString(nodeName);

		// If names are very similar (allow for small differences)
		if (this.levenshteinDistance(normalizedEntity, normalizedNode) <= 2) {
			return true;
		}

		// Check if one name contains the other (useful for abbreviations)
		if (
			normalizedEntity.includes(normalizedNode) ||
			normalizedNode.includes(normalizedEntity)
		) {
			return true;
		}

		// General word-based matching (split by spaces and check common words)
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
			// If most words match, consider it a match
			return commonWords.length >= Math.min(words1.length, words2.length) * 0.6;
		}

		return false;
	}

	private levenshteinDistance(str1: string, str2: string): number {
		const matrix = Array(str2.length + 1)
			.fill(null)
			.map(() => Array(str1.length + 1).fill(null));

		for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
		for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

		for (let j = 1; j <= str2.length; j++) {
			for (let i = 1; i <= str1.length; i++) {
				const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
				matrix[j][i] = Math.min(
					matrix[j][i - 1] + 1, // deletion
					matrix[j - 1][i] + 1, // insertion
					matrix[j - 1][i - 1] + indicator, // substitution
				);
			}
		}

		return matrix[str2.length][str1.length];
	}

	private isPersonNameMatch(name1: string, name2: string): boolean {
		// Handle "First Last" vs "Last, First" formats
		const parts1 = name1
			.toLowerCase()
			.split(/[,\s]+/)
			.filter((p) => p.length > 0);
		const parts2 = name2
			.toLowerCase()
			.split(/[,\s]+/)
			.filter((p) => p.length > 0);

		// Check if all parts of shorter name are in longer name
		const [shorter, longer] =
			parts1.length <= parts2.length ? [parts1, parts2] : [parts2, parts1];
		return shorter.every((part) =>
			longer.some((p) => p.includes(part) || part.includes(p)),
		);
	}

	private isOrganizationNameMatch(name1: string, name2: string): boolean {
		// Remove common organization suffixes for comparison
		const cleanName1 = name1
			.toLowerCase()
			.replace(/\b(inc|llc|corp|corporation|ltd|limited|company|co)\b\.?/g, "")
			.trim();
		const cleanName2 = name2
			.toLowerCase()
			.replace(/\b(inc|llc|corp|corporation|ltd|limited|company|co)\b\.?/g, "")
			.trim();

		return (
			this.normalizeString(cleanName1) === this.normalizeString(cleanName2)
		);
	}

	private isTechnologyNameMatch(name1: string, name2: string): boolean {
		// Handle technology name variations (e.g., "JavaScript" vs "JS", "TypeScript" vs "TS")
		const tech1 = name1.toLowerCase().replace(/[^\w]/g, "");
		const tech2 = name2.toLowerCase().replace(/[^\w]/g, "");

		// Check common abbreviations
		const abbreviations = {
			javascript: ["js"],
			typescript: ["ts"],
			python: ["py"],
			cplusplus: ["cpp"],
			csharp: ["cs"],
		};

		for (const [full, abbrevs] of Object.entries(abbreviations)) {
			if (
				(tech1 === full && abbrevs.includes(tech2)) ||
				(tech2 === full && abbrevs.includes(tech1))
			) {
				return true;
			}
		}

		return tech1 === tech2;
	}

	private logSaveResults(
		state: KnowledgeGraphState,
		result: DatabaseSaveResult,
	): void {
		try {
			if (result.createdNodes?.length) {
				const nodeNames = result.createdNodes
					.map((n) => (n?.name ? `${n.name}` : undefined))
					.filter((n) => n && n.trim().length > 0);
				logInfo("[SAVE_TO_DATABASE] New nodes created", {
					count: result.createdNodes.length,
					names: nodeNames,
				});
			}

			if (result.createdEdges?.length) {
				// Build an id->name map from existing + newly created nodes
				const idToName = new Map<string, string>();
				for (const n of state.existingNodes || []) {
					if (n?.id) idToName.set(String(n.id), n.name ?? String(n.id));
				}
				for (const n of result.createdNodes || []) {
					if (n?.id) idToName.set(String(n.id), n.name ?? String(n.id));
				}

				const edges = result.createdEdges.map((e) => ({
					type: e.edgeType,
					fact: e.factText,
					source: idToName.get(String(e.sourceId)) ?? String(e.sourceId),
					destination:
						idToName.get(String(e.destinationId)) ?? String(e.destinationId),
				}));

				logInfo("[SAVE_TO_DATABASE] New edges created", {
					count: result.createdEdges.length,
					edges,
				});

				const factNames = result.createdEdges
					.map((e) => e.factText)
					.filter(
						(t): t is string => typeof t === "string" && t.trim().length > 0,
					);
				if (factNames.length) {
					logInfo("[SAVE_TO_DATABASE] Facts stored", {
						count: factNames.length,
						facts: factNames,
					});
				}
			}
		} catch (e) {
			// Non-fatal logging error; continue
			logError("[SAVE_TO_DATABASE] Post-save logging failed", e);
		}
	}
}
