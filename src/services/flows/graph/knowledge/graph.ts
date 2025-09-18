import { END, START, StateGraph } from "@langchain/langgraph/web";
import { logInfo, logError } from "@/utils/logger";
import type { NewSource } from "@/services/database/entities/sources";
import type { NewNode } from "@/services/database/entities/nodes";
import type { NewEdge } from "@/services/database/entities/edges";
import { or, and, ilike, inArray } from "drizzle-orm";
import { vectorSearchNodes, vectorSearchEdges } from "@/utils/vector-search";
import {
	trigramSearchNodes,
	trigramSearchEdges,
	combineSearchResultsWithTrigram,
} from "@/utils/trigram-search";

import { KnowledgeGraphAnnotation, type KnowledgeGraphState } from "./state";
import { EntityExtractionFlow } from "./entity-extraction";
import { EntityResolutionFlow } from "./entity-resolution";
import { FactExtractionFlow } from "./fact-extraction";
import { FactResolutionFlow } from "./fact-resolution";
import { TemporalExtractionFlow } from "./temporal-extraction";
import { GraphBase } from "../../interfaces/graph.base";
import type { AllServices } from "../../interfaces/tool";

// Safe embedding generation that continues storage even on failure
async function safeTextToVector(
	embeddingService: any,
	text: string,
	context: string,
): Promise<number[] | null> {
	try {
		if (!text || text.trim().length === 0) return null;
		return await embeddingService.textToVector(text);
	} catch (error) {
		logError(`[${context}] Embedding failed, continuing without vector:`, {
			error: error instanceof Error ? error.message : String(error),
			textLength: text.length,
		});
		return null;
	}
}

export class KnowledgeGraphFlow extends GraphBase<
	| "load_entities"
	| "extract_entities"
	| "resolve_entities"
	| "extract_facts"
	| "load_facts"
	| "resolve_facts"
	| "extract_temporal"
	| "save_to_database",
	KnowledgeGraphState,
	AllServices
> {
	private entityExtraction: EntityExtractionFlow;
	private entityResolution: EntityResolutionFlow;
	private factExtraction: FactExtractionFlow;
	private factResolution: FactResolutionFlow;
	private temporalExtraction: TemporalExtractionFlow;

	constructor(services: AllServices) {
		super(services);
		this.workflow = new StateGraph(KnowledgeGraphAnnotation);

		// Initialize sub-flows
		this.entityExtraction = new EntityExtractionFlow(services);
		this.entityResolution = new EntityResolutionFlow(services);
		this.factExtraction = new FactExtractionFlow(services);
		this.factResolution = new FactResolutionFlow(services);
		this.temporalExtraction = new TemporalExtractionFlow(services);

		// Add nodes
		this.workflow.addNode("load_entities", this.loadExistingEntitiesNode);
		this.workflow.addNode("load_facts", this.loadExistingFactsNode);
		this.workflow.addNode("extract_entities", this.extractEntitiesNode);
		this.workflow.addNode("resolve_entities", this.resolveEntitiesNode);
		this.workflow.addNode("extract_facts", this.extractFactsNode);
		this.workflow.addNode("resolve_facts", this.resolveFactsNode);
		this.workflow.addNode("extract_temporal", this.extractTemporalNode);
		this.workflow.addNode("save_to_database", this.saveToDatabaseNode);

		// Define the flow
		// Ordering: extract -> load entities -> resolve -> extract facts -> load facts -> resolve
		this.workflow.addEdge(START, "extract_entities");
		this.workflow.addEdge("extract_entities", "load_entities");
		this.workflow.addEdge("load_entities", "resolve_entities");
		this.workflow.addEdge("resolve_entities", "extract_facts");
		this.workflow.addEdge("extract_facts", "load_facts");
		this.workflow.addEdge("load_facts", "resolve_facts");
		this.workflow.addEdge("resolve_facts", "extract_temporal");
		this.workflow.addEdge("extract_temporal", "save_to_database");
		this.workflow.addEdge("save_to_database", END);

		// Compile the workflow
		this.compile();
	}

	loadExistingEntitiesNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		try {
			logInfo("[LOAD_ENTITIES] Loading related existing nodes for resolution");

			const databaseService = this.services.database;
			const embeddingService = this.services.embedding;

			if (!databaseService) {
				throw new Error("Database service not available");
			}

			// If we have no extracted entities yet, skip
			const names = (state.extractedEntities || [])
				.map((e) => e.name)
				.filter((n) => n && n.trim().length > 0);
			if (names.length === 0) {
				return { existingNodes: [], existingEdges: [] };
			}

			const TOTAL_LIMIT = 200;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// Perform SQL search (existing logic)
			const sqlResults = await databaseService.use(async ({ db, schema }) => {
				const conditions = names.flatMap((n) => {
					const pat = `%${n}%`;
					return [
						ilike(schema.nodes.name, pat),
						ilike(schema.nodes.summary, pat),
					];
				});
				if (conditions.length === 0)
					return [] as (typeof schema.nodes.$inferSelect)[];
				const where = or(...conditions);
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
				trigramResults = await trigramSearchNodes(
					databaseService,
					names,
					Math.floor((TOTAL_LIMIT * WEIGHTS.trigramPercentage) / 100),
					{ threshold: 0.1 },
				);
			} catch (error) {
				logError("[LOAD_ENTITIES] Trigram search failed:", error);
			}

			// Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorResults: {
				item: (typeof sqlResults)[0];
				similarity: number;
			}[] = [];
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
						);
					}
				} catch (error) {
					logError("[LOAD_ENTITIES] Vector search fallback failed:", error);
				}
			}

			// Combine results with deduplication - use new trigram combiner
			const related = combineSearchResultsWithTrigram(
				sqlResults,
				vectorResults,
				trigramResults,
				WEIGHTS,
				TOTAL_LIMIT,
				(node) => node.id,
			);

			logInfo(
				`[LOAD_ENTITIES] Loaded ${related.length} related nodes (${sqlResults.length} SQL, ${trigramResults.length} trigram, ${vectorResults.length} vector)`,
			);

			return {
				existingNodes: related,
				// Defer edge loading; load_facts will query per facts
				existingEdges: [],
				actions: [
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
				],
			};
		} catch (error) {
			logError("[LOAD_ENTITIES] Error:", error);
			return {
				errors: [
					error instanceof Error
						? error.message
						: "Failed to load existing data",
				],
				existingNodes: [],
				existingEdges: [],
			};
		}
	};

	loadExistingFactsNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		try {
			logInfo("[LOAD_FACTS] Loading related edges for fact resolution");
			const databaseService = this.services.database;
			const embeddingService = this.services.embedding;

			if (!databaseService) {
				throw new Error("Database service not available");
			}

			if (!state.extractedFacts || state.extractedFacts.length === 0) {
				return { existingEdges: [] };
			}

			const TOTAL_LIMIT = 500;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// Collect candidate node IDs from resolved entities
			const candidateIds = new Set<string>();
			for (const ent of state.resolvedEntities || []) {
				if (ent.isExisting && ent.existingId) candidateIds.add(ent.existingId);
			}
			const unresolvedNames = (state.resolvedEntities || [])
				.filter((e) => !e.isExisting || !e.existingId)
				.map((e) => e.finalName);

			// Find additional nodes for unresolved entities
			if (unresolvedNames.length > 0) {
				const found = await databaseService.use(async ({ db, schema }) => {
					const conditions = unresolvedNames.flatMap((n) => {
						const pat = `%${n}%`;
						return [
							ilike(schema.nodes.name, pat),
							ilike(schema.nodes.summary, pat),
						];
					});
					if (conditions.length === 0) return [] as { id: string }[];
					const rows = await db
						.select({ id: schema.nodes.id })
						.from(schema.nodes)
						.where(or(...conditions)!)
						.limit(200);
					return rows;
				});
				for (const r of found) candidateIds.add(r.id);
			}

			const idList = Array.from(candidateIds);

			// 1. SQL-based edge search (relations from resolved entities)
			let sqlResults: typeof state.existingEdges = [];
			if (idList.length > 0) {
				sqlResults = await databaseService.use(async ({ db, schema }) => {
					return db
						.select()
						.from(schema.edges)
						.where(
							or(
								inArray(schema.edges.sourceId, idList),
								inArray(schema.edges.destinationId, idList),
							)!,
						)
						.limit(Math.floor((TOTAL_LIMIT * WEIGHTS.sqlPercentage) / 100));
				});
			}

			// 2. Trigram search based on extracted facts
			let trigramResults: Awaited<ReturnType<typeof trigramSearchEdges>> = [];
			if (state.extractedFacts.length > 0) {
				try {
					// Create search terms from extracted facts
					const factSearchTerms = state.extractedFacts
						.map((f) => `${f.relationType} ${f.factText || ""}`.trim())
						.filter((term) => term.length > 0);

					if (factSearchTerms.length > 0) {
						trigramResults = await trigramSearchEdges(
							databaseService,
							factSearchTerms,
							Math.floor((TOTAL_LIMIT * WEIGHTS.trigramPercentage) / 100),
							{ threshold: 0.1 },
						);
					}
				} catch (error) {
					logError("[LOAD_FACTS] Trigram search failed:", error);
				}
			}

			// 3. Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorResults: {
				item: (typeof sqlResults)[0];
				similarity: number;
			}[] = [];
			const combinedResults = sqlResults.length + trigramResults.length;

			if (
				combinedResults < TOTAL_LIMIT * 0.5 &&
				embeddingService &&
				state.extractedFacts.length > 0
			) {
				try {
					const defaultEmbedding = await embeddingService.get("default");
					if (defaultEmbedding && defaultEmbedding.isReady()) {
						// Create search terms from extracted facts
						const factSearchTerms = state.extractedFacts
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
							);
						}
					}
				} catch (error) {
					logError("[LOAD_FACTS] Vector search fallback failed:", error);
				}
			}

			// 4. Additional relations from resolved entity connections (if space available)
			let relationResults: typeof sqlResults = [];
			const usedSpace =
				sqlResults.length + trigramResults.length + vectorResults.length;
			const remainingSpace = TOTAL_LIMIT - usedSpace;

			if (remainingSpace > 0 && idList.length > 0) {
				// Find edges that connect any of our resolved entities to other entities
				relationResults = await databaseService.use(async ({ db, schema }) => {
					// Find edges where both source and destination are in our candidate list
					return db
						.select()
						.from(schema.edges)
						.where(
							and(
								inArray(schema.edges.sourceId, idList),
								inArray(schema.edges.destinationId, idList),
							)!,
						)
						.limit(remainingSpace);
				});
			}

			// Combine all results with deduplication using trigram combiner
			const edges = combineSearchResultsWithTrigram(
				[...sqlResults, ...relationResults], // Combine SQL and relation results
				vectorResults,
				trigramResults,
				WEIGHTS,
				TOTAL_LIMIT,
				(edge) => edge.id,
			);

			// Ensure node data for edges
			const nodeIds = Array.from(
				new Set<string>(edges.flatMap((e) => [e.sourceId, e.destinationId])),
			);
			const missingNodeIds = nodeIds.filter(
				(id) => !(state.existingNodes || []).some((n) => n.id === id),
			);
			let newNodes: KnowledgeGraphState["existingNodes"] = [];
			if (missingNodeIds.length > 0) {
				newNodes = await databaseService.use(async ({ db, schema }) => {
					return db
						.select()
						.from(schema.nodes)
						.where(inArray(schema.nodes.id, missingNodeIds));
				});
			}

			logInfo(
				`[LOAD_FACTS] Loaded ${edges.length} related edges (${sqlResults.length} SQL, ${trigramResults.length} trigram, ${vectorResults.length} vector, ${relationResults.length} relations)`,
			);

			return {
				existingEdges: edges,
				existingNodes: (state.existingNodes || []).concat(newNodes),
				actions: [
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
				],
			};
		} catch (error) {
			logError("[LOAD_FACTS] Error:", error);
			return {
				errors: [
					error instanceof Error
						? error.message
						: "Failed to load facts context",
				],
			};
		}
	};

	extractEntitiesNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		logInfo("[EXTRACT_ENTITIES] Starting entity extraction node", {
			url: state.url,
			pageId: state.pageId,
			processingStage: state.processingStage,
		});
		const result = await this.entityExtraction.extractEntities(state);
		logInfo("[EXTRACT_ENTITIES] Entity extraction completed", {
			nextStage: result.processingStage,
			entitiesCount: result.extractedEntities?.length || 0,
		});
		return result;
	};

	resolveEntitiesNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		return await this.entityResolution.resolveEntities(state);
	};

	extractFactsNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		return await this.factExtraction.extractFacts(state);
	};

	resolveFactsNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		return await this.factResolution.resolveFacts(state);
	};

	extractTemporalNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		return await this.temporalExtraction.extractTemporal(state);
	};

	saveToDatabaseNode = async (
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> => {
		try {
			logInfo("[SAVE_TO_DATABASE] Saving knowledge graph to database");
			logInfo("[SAVE_TO_DATABASE] State debug:", {
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

			const result = await databaseService.use(async ({ db, schema }) => {
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
				logInfo("💾 Creating source with polymorphic relation", {
					targetType: "remembered_pages",
					targetId: state.pageId,
					hasPageId: !!state.pageId,
					title: state.title,
				});

				const sourceData: NewSource = {
					targetType: "remembered_pages",
					targetId: state.pageId.trim(),
					name: state.title.trim(),
					metadata: state.metadata || {},
					referenceTime: new Date(state.referenceTimestamp),
					weight: 1.0,
				};

				const [createdSource] = await db
					.insert(schema.sources)
					.values(sourceData)
					.returning();

				// Create new nodes
				const createdNodes: (typeof schema.nodes.$inferSelect)[] = [];
				const newEntities = state.resolvedEntities.filter((e) => !e.isExisting);

				for (const entity of newEntities) {
					const nodeData: NewNode = {
						nodeType: entity.nodeType,
						name: entity.finalName,
						summary: entity.summary,
						attributes: entity.attributes || {},
					};

					// Generate embedding for node name
					if (embeddingService) {
						const nameEmbedding = await safeTextToVector(
							embeddingService,
							entity.finalName,
							`NODE_EMBEDDING:${entity.finalName.substring(0, 50)}`,
						);
						if (nameEmbedding) {
							nodeData.nameEmbedding = nameEmbedding;
						}
					}

					const [createdNode] = await db
						.insert(schema.nodes)
						.values(nodeData)
						.returning();

					createdNodes.push(createdNode);

					// Create source-node relationship
					await db.insert(schema.sourceNodes).values({
						sourceId: createdSource.id,
						nodeId: createdNode.id,
						relation: "MENTIONED_IN",
					});
				}

				// Create new edges
				const createdEdges = [];
				const newFacts = state.enrichedFacts.filter((f) => !f.isExisting);

				for (const fact of newFacts) {
					// Map entity UUIDs to actual node IDs
					const sourceEntity = state.resolvedEntities.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = state.resolvedEntities.find(
						(e) => e.uuid === fact.destinationEntityId,
					);

					if (!sourceEntity || !destEntity) {
						logError(
							`[SAVE_TO_DATABASE] Could not find entities for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
						);
						continue;
					}

					// Get actual node IDs
					let sourceNodeId: string;
					let destNodeId: string;

					if (sourceEntity.isExisting && sourceEntity.existingId) {
						sourceNodeId = sourceEntity.existingId;
					} else {
						const newNode = createdNodes.find(
							(n) => n.name === sourceEntity.finalName,
						);
						if (!newNode) {
							logError(
								`[SAVE_TO_DATABASE] Could not find created node for entity: ${sourceEntity.finalName}`,
							);
							continue;
						}
						sourceNodeId = `${newNode.id}`;
					}

					if (destEntity.isExisting && destEntity.existingId) {
						destNodeId = destEntity.existingId;
					} else {
						const newNode = createdNodes.find(
							(n) => n.name === destEntity.finalName,
						);
						if (!newNode) {
							logError(
								`[SAVE_TO_DATABASE] Could not find created node for entity: ${destEntity.finalName}`,
							);
							continue;
						}
						destNodeId = `${newNode.id}`;
					}

					const edgeData: NewEdge = {
						sourceId: sourceNodeId,
						destinationId: destNodeId,
						edgeType: fact.relationType,
						factText: fact.factText,
						validAt: fact.temporal.validAt
							? new Date(fact.temporal.validAt)
							: undefined,
						invalidAt: fact.temporal.invalidAt
							? new Date(fact.temporal.invalidAt)
							: undefined,
						attributes: fact.attributes || {},
					};

					// Generate embedding for fact
					if (embeddingService) {
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
					}

					const [createdEdge] = await db
						.insert(schema.edges)
						.values(edgeData)
						.returning();

					createdEdges.push(createdEdge);

					// Create source-edge relationship
					await db.insert(schema.sourceEdges).values({
						sourceId: createdSource.id,
						edgeId: createdEdge.id,
						relation: "EXTRACTED_FROM",
						linkWeight: 1.0,
					});
				}

				return { createdSource, createdNodes, createdEdges };
			});

			logInfo(
				`[SAVE_TO_DATABASE] Successfully saved ${result.createdNodes.length} nodes and ${result.createdEdges.length} edges`,
			);

			// Extra success logs with names/details
			try {
				if (result.createdNodes?.length) {
					const nodeNames = result.createdNodes
						.map((n) => n.name)
						.filter((n) => typeof n === "string" && n.trim().length > 0);
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
	};
}
