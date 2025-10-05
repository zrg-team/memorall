import { END, START, StateGraph } from "@langchain/langgraph/web";
import { KnowledgeRAGAnnotation, type KnowledgeRAGState } from "./state";
import { GraphBase } from "@/services/flows/interfaces/graph.base";
import type { AllServices } from "@/services/flows/interfaces/tool";
import type { ChatCompletionResponse, ChatMessage } from "@/types/openai";
import { logError, logInfo } from "@/utils/logger";
import { eq, or, like, desc, inArray } from "drizzle-orm";
import type { Node, Edge } from "@/services/database/db";
import {
	trigramSearchNodes,
	trigramSearchEdges,
	combineSearchResultsWithTrigram,
} from "@/utils/trigram-search";
import { vectorSearchNodes, vectorSearchEdges } from "@/utils/vector-search";
import type { DatabaseService } from "@/services/database/database-service";
import type { BaseEmbedding } from "@/services/embedding";

// Types for vector search results with similarity scores
interface NodeWithSimilarity extends Node {
	similarity: number;
}

interface EdgeWithSimilarity extends Edge {
	similarity: number;
}

const QUERY_ANALYSIS_PROMPT = `
You are an expert at analyzing user queries for knowledge graph retrieval.

Analyze the user query and extract:
1. Key entities mentioned (people, places, concepts, organizations)
2. Query intent: "factual" (seeking facts), "relationship" (asking about connections), "summary" (wanting overview), "exploration" (browsing/discovery)

User Query: {query}

Respond in this exact JSON format:
{
  "entities": ["entity1", "entity2"],
  "intent": "factual|relationship|summary|exploration"
}
`;

const RESPONSE_GENERATION_PROMPT = `
You are a knowledgeable assistant that can answer questions using a knowledge graph.

User Query: {query}

Available Knowledge Context:
{context}

Using the provided knowledge context, provide a comprehensive and accurate answer to the user's query.
If the knowledge graph doesn't contain enough information to fully answer the question, mention what information is available and what might be missing.
Cite specific facts and relationships from the knowledge graph in your response.
`;

export interface KnowledgeRAGConfig {
	quickMode?: boolean;
	maxGrowthLevels?: number;
	searchLimit?: number;
}

// Graph growth configuration
interface GraphGrowthConfig {
	maxLevels: number;
	nodesPerLevel: number;
	edgesPerLevel: number;
}

export class KnowledgeRAGFlow extends GraphBase<
	| "analyze_query"
	| "retrieve_knowledge"
	| "quick_retrieve"
	| "build_context"
	| "generate_response",
	KnowledgeRAGState,
	AllServices
> {
	private config: KnowledgeRAGConfig;

	constructor(services: AllServices, config: KnowledgeRAGConfig = {}) {
		super(services);
		this.config = {
			quickMode: true,
			maxGrowthLevels: 3,
			searchLimit: 50,
			...config,
		};
		this.workflow = new StateGraph(KnowledgeRAGAnnotation);

		// Add common nodes
		this.workflow.addNode("build_context", this.buildContextNode);
		this.workflow.addNode("generate_response", this.generateResponseNode);

		// Add nodes and edges based on configuration
		if (this.config.quickMode) {
			// Quick mode: skip query analysis and go straight to semantic search
			this.workflow.addNode("quick_retrieve", this.quickRetrieveNode);
			this.workflow.addEdge(START, "quick_retrieve");
			this.workflow.addEdge("quick_retrieve", "build_context");
		} else {
			// Standard mode: use LLM analysis
			this.workflow.addNode("analyze_query", this.analyzeQueryNode);
			this.workflow.addNode("retrieve_knowledge", this.retrieveKnowledgeNode);
			this.workflow.addEdge(START, "analyze_query");
			this.workflow.addEdge("analyze_query", "retrieve_knowledge");
			this.workflow.addEdge("retrieve_knowledge", "build_context");
		}

		this.workflow.addEdge("build_context", "generate_response");
		this.workflow.addEdge("generate_response", END);

		// Compile the workflow
		this.compile();
	}

	analyzeQueryNode = async (
		state: KnowledgeRAGState,
	): Promise<Partial<KnowledgeRAGState>> => {
		const llm = this.services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		try {
			logInfo("[KNOWLEDGE_RAG] Analyzing query:", state.query);

			const prompt = QUERY_ANALYSIS_PROMPT.replace("{query}", state.query);

			const messages: ChatMessage[] = [{ role: "system", content: prompt }];

			const llmResponse = (await llm.chatCompletions({
				messages,
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;

			const responseContent = llmResponse.choices[0].message.content || "";

			// Parse JSON response
			let analysisResult: { entities: string[]; intent: string } | undefined;
			try {
				const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					analysisResult = JSON.parse(jsonMatch[0]);
				} else {
					throw new Error("No JSON found in response");
				}
			} catch (parseError) {
				logError(
					"[KNOWLEDGE_RAG] Failed to parse analysis response:",
					parseError,
				);
				// Fallback to simple entity extraction
				analysisResult = {
					entities: state.query.split(" ").filter((word) => word.length > 3),
					intent: "factual",
				};
			}

			return {
				extractedEntities: analysisResult?.entities || [],
				queryIntent: (analysisResult?.intent ||
					"factual") as KnowledgeRAGState["queryIntent"],
				next: "retrieve_knowledge",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Query Analysis",
						description: `Extracted ${analysisResult?.entities?.map((e) => `"${e}"`).join(", ")} entities with "${analysisResult?.intent}" intent`,
						metadata: {
							entities: analysisResult?.entities,
							intent: analysisResult?.intent,
						},
					},
				],
			};
		} catch (error) {
			logError("[KNOWLEDGE_RAG] Query analysis failed:", error);
			throw error;
		}
	};

	retrieveKnowledgeNode = async (
		state: KnowledgeRAGState,
	): Promise<Partial<KnowledgeRAGState>> => {
		const database = this.services.database;
		const embedding = this.services.embedding;

		try {
			let relevantNodes: KnowledgeRAGState["relevantNodes"] = [];
			let relevantEdges: KnowledgeRAGState["relevantEdges"] = [];

			const TOTAL_NODE_LIMIT = 15;
			const TOTAL_EDGE_LIMIT = 20;
			const WEIGHTS = {
				sqlPercentage: 60,
				trigramPercentage: 40,
				vectorPercentage: 0,
			};

			// 1. SQL search for nodes
			const sqlNodes = await database.use(async ({ db, schema }) => {
				if (state.extractedEntities.length === 0) return [];

				const entitySearchConditions = state.extractedEntities.map((entity) =>
					or(
						like(schema.nodes.name, `%${entity}%`),
						like(schema.nodes.summary, `%${entity}%`),
					),
				);

				// Add topic filter if provided
				const whereConditions = state.topicId
					? [
							or(...entitySearchConditions),
							eq(schema.nodes.graph, state.topicId),
						]
					: [or(...entitySearchConditions)];

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
					.where(
						state.topicId
							? or(...whereConditions)
							: or(...entitySearchConditions),
					)
					.orderBy(desc(schema.nodes.createdAt))
					.limit(Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.sqlPercentage) / 100));
			});

			// 2. SQL search for edges
			const sqlEdges = await database.use(async ({ db, schema }) => {
				if (state.extractedEntities.length === 0) return [];

				const factSearchConditions = state.extractedEntities.map((entity) =>
					like(schema.edges.factText, `%${entity}%`),
				);

				// Add topic filter if provided
				const whereConditions = state.topicId
					? [or(...factSearchConditions), eq(schema.edges.graph, state.topicId)]
					: [or(...factSearchConditions)];

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
					.where(
						state.topicId
							? or(...whereConditions)
							: or(...factSearchConditions),
					)
					.orderBy(desc(schema.edges.createdAt))
					.limit(Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.sqlPercentage) / 100));
			});

			// 3. Trigram search for nodes
			let trigramNodeResults: Awaited<ReturnType<typeof trigramSearchNodes>> =
				[];
			if (state.extractedEntities.length > 0) {
				try {
					trigramNodeResults = await trigramSearchNodes(
						database,
						state.extractedEntities,
						Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 },
					);
				} catch (error) {
					logError("[KNOWLEDGE_RAG] Trigram search for nodes failed:", error);
				}
			}

			// 4. Trigram search for edges
			let trigramEdgeResults: Awaited<ReturnType<typeof trigramSearchEdges>> =
				[];
			if (state.extractedEntities.length > 0) {
				try {
					trigramEdgeResults = await trigramSearchEdges(
						database,
						state.extractedEntities,
						Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 },
					);
				} catch (error) {
					logError("[KNOWLEDGE_RAG] Trigram search for edges failed:", error);
				}
			}

			// 5. Fallback to vector search if both SQL and trigram fail or have insufficient results
			let vectorNodes: Node[] = [];
			let vectorEdges: Edge[] = [];
			const combinedNodeResults = sqlNodes.length + trigramNodeResults.length;
			const combinedEdgeResults = sqlEdges.length + trigramEdgeResults.length;

			if (
				(combinedNodeResults < TOTAL_NODE_LIMIT * 0.5 ||
					combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) &&
				embedding
			) {
				try {
					// Generate embedding for search terms
					const searchText = state.extractedEntities.join(" ");
					const searchEmbedding = await embedding.textToVector(searchText);

					// Vector search for nodes
					if (combinedNodeResults < TOTAL_NODE_LIMIT * 0.5) {
						const vectorNodeResults = await database.use(async ({ raw }) => {
							const topicFilter = state.topicId ? " AND graph = $3" : "";
							const query = `
								SELECT *,
									1 - (name_embedding <=> $1::vector) as similarity
								FROM nodes
								WHERE name_embedding IS NOT NULL${topicFilter}
								ORDER BY similarity DESC
								LIMIT $2
							`;
							const nodeLimit = Math.min(
								TOTAL_NODE_LIMIT - combinedNodeResults,
								Math.floor(TOTAL_NODE_LIMIT * 0.4),
							);
							const params = state.topicId
								? [JSON.stringify(searchEmbedding), nodeLimit, state.topicId]
								: [JSON.stringify(searchEmbedding), nodeLimit];
							const result = await raw(query, params);
							return (result as { rows: NodeWithSimilarity[] })?.rows || [];
						});
						vectorNodes = vectorNodeResults;
					}

					// Vector search for edges
					if (combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) {
						const vectorEdgeResults = await database.use(async ({ raw }) => {
							const topicFilter = state.topicId ? " AND graph = $3" : "";
							const query = `
								SELECT *,
									1 - (fact_embedding <=> $1::vector) as similarity
								FROM edges
								WHERE fact_embedding IS NOT NULL${topicFilter}
								ORDER BY similarity DESC
								LIMIT $2
							`;
							const edgeLimit = Math.min(
								TOTAL_EDGE_LIMIT - combinedEdgeResults,
								Math.floor(TOTAL_EDGE_LIMIT * 0.4),
							);
							const params = state.topicId
								? [JSON.stringify(searchEmbedding), edgeLimit, state.topicId]
								: [JSON.stringify(searchEmbedding), edgeLimit];
							const result = await raw(query, params);
							return (result as { rows: EdgeWithSimilarity[] })?.rows || [];
						});
						vectorEdges = vectorEdgeResults;
					}
				} catch (embeddingError) {
					logError(
						"[KNOWLEDGE_RAG] Vector search fallback failed:",
						embeddingError,
					);
				}
			}

			// 6. Combine results using trigram combiner
			const combinedNodes = combineSearchResultsWithTrigram(
				sqlNodes,
				vectorNodes.map((node) => ({
					item: node,
					similarity:
						"similarity" in node && typeof node.similarity === "number"
							? node.similarity
							: 0,
				})),
				trigramNodeResults,
				WEIGHTS,
				TOTAL_NODE_LIMIT,
				(node) => node.id!,
			);

			const combinedEdges = combineSearchResultsWithTrigram(
				sqlEdges,
				vectorEdges.map((edge) => ({
					item: edge,
					similarity:
						"similarity" in edge && typeof edge.similarity === "number"
							? edge.similarity
							: 0,
				})),
				trigramEdgeResults,
				WEIGHTS,
				TOTAL_EDGE_LIMIT,
				(edge) => edge.id!,
			);

			// 4. Process and score nodes
			relevantNodes = combinedNodes.map((node) => {
				let relevanceScore = 0;

				// Text-based relevance
				// Text-based relevance
				state.extractedEntities.forEach((entity) => {
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

			// 5. Get missing nodes for complete fact context
			const edgeNodeIds = [
				...new Set([
					...combinedEdges.map((edge) => edge.sourceId),
					...combinedEdges.map((edge) => edge.destinationId),
				]),
			];

			const missingNodeIds = edgeNodeIds.filter(
				(id) => !relevantNodes.find((node) => node.id === id),
			);

			if (missingNodeIds.length > 0) {
				const missingNodes = await database.use(async ({ db, schema }) => {
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
							or(...missingNodeIds.map((id) => eq(schema.nodes.id, `${id}`))),
						);
				});

				const additionalNodes = missingNodes.map((node) => ({
					id: node.id,
					nodeType: node.nodeType,
					name: node.name,
					summary: node.summary || "",
					attributes: (node.attributes as Record<string, unknown>) || {},
					relevanceScore: 1,
				}));

				relevantNodes = [...relevantNodes, ...additionalNodes];
			}

			// 6. Process edges
			relevantEdges = combinedEdges.map((edge) => {
				let relevanceScore = 0;

				// Score based on fact text relevance
				state.extractedEntities.forEach((entity) => {
					if (edge.factText?.toLowerCase().includes(entity.toLowerCase())) {
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

			logInfo("[KNOWLEDGE_RAG] Retrieved knowledge:", {
				nodes: relevantNodes.length,
				edges: relevantEdges.length,
				sqlNodes: sqlNodes.length,
				trigramNodes: trigramNodeResults.length,
				vectorNodes: vectorNodes.length,
				sqlEdges: sqlEdges.length,
				trigramEdges: trigramEdgeResults.length,
				vectorEdges: vectorEdges.length,
			});

			return {
				relevantNodes,
				relevantEdges,
				next: "build_context",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Knowledge Retrieval",
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
				],
			};
		} catch (error) {
			logError("[KNOWLEDGE_RAG] Knowledge retrieval failed:", error);
			throw error;
		}
	};

	buildContextNode = async (
		state: KnowledgeRAGState,
	): Promise<Partial<KnowledgeRAGState>> => {
		try {
			logInfo(
				"[KNOWLEDGE_RAG] Building knowledge context in natural language format",
			);

			// 1. Build definitions section - entity names and summaries
			const definitions = state.relevantNodes
				.map((node) => `${node.name}: ${node.summary}.`)
				.join("\n");

			// 2. Build facts section - entity connections with fact text
			const facts = state.relevantEdges
				.map((edge) => {
					const sourceName =
						state.relevantNodes.find((n) => n.id === edge.sourceId)?.name ||
						"Unknown";
					const destName =
						state.relevantNodes.find((n) => n.id === edge.destinationId)
							?.name || "Unknown";
					return `${sourceName} ${edge.edgeType} ${destName}, ${edge.factText}.`;
				})
				.join("\n");

			// 3. Generate Mermaid diagram
			const mermaidDiagram = this.generateMermaidDiagram(
				state.relevantNodes,
				state.relevantEdges,
			);

			// 4. Build natural language context
			const knowledgeContext = `<definitions>${definitions}</definitions>

<facts>${facts}</facts>`;

			logInfo("[KNOWLEDGE_RAG] Built natural language context:", {
				definitionsLength: definitions.length,
				factsLength: facts.length,
				nodesCount: state.relevantNodes.length,
				edgesCount: state.relevantEdges.length,
			});

			return {
				knowledgeContext,
				mermaidDiagram,
				next: "generate_response",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Context Graph",
						description: `\`\`\`mermaid\n${mermaidDiagram}\n\`\`\``,
						metadata: {
							definitionsCount: state.relevantNodes.length,
							factsCount: state.relevantEdges.length,
							hasMermaid: true,
						},
					},
					{
						id: crypto.randomUUID(),
						name: "Context Knowledge",
						description: knowledgeContext,
						metadata: {},
					},
				],
			};
		} catch (error) {
			logError("[KNOWLEDGE_RAG] Context building failed:", error);
			throw error;
		}
	};

	// Helper function to generate Mermaid diagram
	private generateMermaidDiagram(
		nodes: KnowledgeRAGState["relevantNodes"],
		edges: KnowledgeRAGState["relevantEdges"],
	): string {
		const nodeMap = new Map(
			nodes.map((node) => [node.id, node.name.replace(/[^a-zA-Z0-9]/g, "_")]),
		);

		let mermaid = "graph TD\n";

		// Add nodes with labels
		nodes.forEach((node) => {
			const nodeId = nodeMap.get(node.id);
			const nodeLabel =
				node.name.length > 20 ? node.name.substring(0, 20) + "..." : node.name;
			mermaid += `    ${nodeId}["${nodeLabel}"]\n`;
		});

		// Add edges
		edges.forEach((edge) => {
			const sourceId = nodeMap.get(edge.sourceId);
			const destId = nodeMap.get(edge.destinationId);

			if (sourceId && destId) {
				const edgeLabel =
					edge.edgeType.length > 15
						? edge.edgeType.substring(0, 15) + "..."
						: edge.edgeType;
				mermaid += `    ${sourceId} -->|${edgeLabel}| ${destId}\n`;
			}
		});

		return mermaid;
	}

	generateResponseNode = async (
		state: KnowledgeRAGState,
	): Promise<Partial<KnowledgeRAGState>> => {
		const llm = this.services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		try {
			logInfo("[KNOWLEDGE_RAG] Generating final response");

			const prompt = RESPONSE_GENERATION_PROMPT.replace(
				"{query}",
				state.query,
			).replace("{context}", state.knowledgeContext);

			const messages: ChatMessage[] = [{ role: "system", content: prompt }];

			const llmResponse = await llm.chatCompletions({
				messages,
				max_tokens: 4096,
				temperature: 0.3,
				stream: true,
			});

			let responseContent = "";
			if (Symbol.asyncIterator in llmResponse) {
				for await (const chunk of llmResponse) {
					responseContent += chunk.choices[0].delta.content || "";
					if (this.callbacks?.onNewChunk) {
						this.callbacks.onNewChunk(chunk);
					}
				}
			}

			return {
				finalMessage: responseContent,
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Response Generation",
						description: "Generated knowledge-based response",
						metadata: { responseLength: responseContent.length },
					},
				],
			};
		} catch (error) {
			logError("[KNOWLEDGE_RAG] Response generation failed:", error);
			throw error;
		}
	};

	quickRetrieveNode = async (
		state: KnowledgeRAGState,
	): Promise<Partial<KnowledgeRAGState>> => {
		try {
			logInfo(
				"[KNOWLEDGE_RAG] Quick mode: Starting semantic search and graph growth",
			);

			const databaseService = this.services.database;
			const embeddingService = this.services.embedding;

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
			const initialResults = await this.performSemanticSearch(
				databaseService,
				defaultEmbedding,
				state.query,
				this.config.searchLimit || 50,
				state.topicId,
			);

			// Step 2: Grow the graph from initial results
			const grownResults = await this.growKnowledgeGraph(
				databaseService,
				initialResults.nodes,
				initialResults.edges,
				{
					maxLevels: this.config.maxGrowthLevels || 3,
					nodesPerLevel: 20,
					edgesPerLevel: 30,
				},
			);

			logInfo("[KNOWLEDGE_RAG] Quick mode results:", {
				initialNodes: initialResults.nodes.length,
				initialEdges: initialResults.edges.length,
				grownNodes: grownResults.nodes.length,
				grownEdges: grownResults.edges.length,
				growthLevels: this.config.maxGrowthLevels,
			});

			return {
				relevantNodes: grownResults.nodes,
				relevantEdges: grownResults.edges,
				extractedEntities: [], // Not used in quick mode
				queryIntent: "factual", // Default intent for quick mode
				next: "build_context",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Quick Knowledge Retrieval",
						description: `Found ${grownResults.nodes.length} nodes and ${grownResults.edges.length} relationships using semantic search and ${this.config.maxGrowthLevels} levels of graph growth`,
						metadata: {
							mode: "quick",
							initialNodeCount: initialResults.nodes.length,
							initialEdgeCount: initialResults.edges.length,
							grownNodeCount: grownResults.nodes.length,
							grownEdgeCount: grownResults.edges.length,
							growthLevels: this.config.maxGrowthLevels,
						},
					},
				],
			};
		} catch (error) {
			logError("[KNOWLEDGE_RAG] Quick retrieve failed:", error);
			throw error;
		}
	};

	private async performSemanticSearch(
		databaseService: DatabaseService,
		embeddingService: BaseEmbedding,
		query: string,
		limit: number,
		topicId?: string,
	): Promise<{
		nodes: KnowledgeRAGState["relevantNodes"];
		edges: KnowledgeRAGState["relevantEdges"];
	}> {
		// Search for semantically relevant nodes
		const nodeResults = await vectorSearchNodes(
			databaseService,
			embeddingService,
			[query],
			Math.floor(limit * 0.6), // 60% for nodes
			topicId, // Use topicId as graphFilter parameter
		);

		// Search for semantically relevant edges
		const edgeResults = await vectorSearchEdges(
			databaseService,
			embeddingService,
			[query],
			Math.floor(limit * 0.4), // 40% for edges
			topicId, // Use topicId as graphFilter parameter
		);

		// Convert to state format
		const nodes: KnowledgeRAGState["relevantNodes"] = nodeResults.map(
			(result) => ({
				id: String(result.item.id),
				nodeType: result.item.nodeType || "",
				name: result.item.name || "",
				summary: result.item.summary || "",
				attributes: (result.item.attributes || {}) as Record<string, unknown>,
				relevanceScore: result.similarity,
			}),
		);

		const edges: KnowledgeRAGState["relevantEdges"] = edgeResults.map(
			(result) => ({
				id: String(result.item.id),
				sourceId: String(result.item.sourceId),
				destinationId: String(result.item.destinationId),
				edgeType: result.item.edgeType || "",
				factText: result.item.factText || "",
				attributes: (result.item.attributes || {}) as Record<string, unknown>,
				relevanceScore: result.similarity,
			}),
		);

		return { nodes, edges };
	}

	private async growKnowledgeGraph(
		databaseService: DatabaseService,
		initialNodes: KnowledgeRAGState["relevantNodes"],
		initialEdges: KnowledgeRAGState["relevantEdges"],
		config: GraphGrowthConfig,
	): Promise<{
		nodes: KnowledgeRAGState["relevantNodes"];
		edges: KnowledgeRAGState["relevantEdges"];
	}> {
		const allNodes = new Map<string, KnowledgeRAGState["relevantNodes"][0]>();
		const allEdges = new Map<string, KnowledgeRAGState["relevantEdges"][0]>();

		// Add initial results
		initialNodes.forEach((node) => allNodes.set(node.id, node));
		initialEdges.forEach((edge) => allEdges.set(edge.id, edge));

		let currentLevelNodeIds = new Set(initialNodes.map((n) => n.id));

		// Grow the graph level by level
		for (let level = 0; level < config.maxLevels; level++) {
			logInfo(
				`[KNOWLEDGE_RAG] Growing graph level ${level + 1}/${config.maxLevels}`,
			);

			if (currentLevelNodeIds.size === 0) break;

			const { newNodes, newEdges, nextLevelNodeIds } =
				await this.expandGraphLevel(
					databaseService,
					Array.from(currentLevelNodeIds),
					config.nodesPerLevel,
					config.edgesPerLevel,
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

	private async expandGraphLevel(
		databaseService: DatabaseService,
		nodeIds: string[],
		maxNodes: number,
		maxEdges: number,
	): Promise<{
		newNodes: KnowledgeRAGState["relevantNodes"];
		newEdges: KnowledgeRAGState["relevantEdges"];
		nextLevelNodeIds: Set<string>;
	}> {
		if (nodeIds.length === 0) {
			return { newNodes: [], newEdges: [], nextLevelNodeIds: new Set() };
		}

		const result = await databaseService.use(async ({ db, schema }) => {
			// Find all edges connected to current nodes
			const connectedEdges = await db
				.select()
				.from(schema.edges)
				.where(
					or(
						inArray(schema.edges.sourceId, nodeIds),
						inArray(schema.edges.destinationId, nodeIds),
					),
				)
				.limit(maxEdges);

			// Get all unique node IDs from the edges (excluding current nodes)
			const newNodeIds = new Set<string>();
			connectedEdges.forEach((edge) => {
				const sourceId = String(edge.sourceId);
				const destId = String(edge.destinationId);

				if (!nodeIds.includes(sourceId)) {
					newNodeIds.add(sourceId);
				}
				if (!nodeIds.includes(destId)) {
					newNodeIds.add(destId);
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
		const newNodes: KnowledgeRAGState["relevantNodes"] =
			result.connectedNodes.map((node) => ({
				id: String(node.id),
				nodeType: node.nodeType,
				name: node.name,
				summary: node.summary || "",
				attributes: (node.attributes || {}) as Record<string, unknown>,
				relevanceScore: 0.5, // Default for grown nodes
			}));

		const newEdges: KnowledgeRAGState["relevantEdges"] =
			result.connectedEdges.map((edge) => ({
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
}

// Self-register the flow
import { flowRegistry } from "../../flow-registry";

flowRegistry.register({
	flowType: "knowledge-rag",
	factory: (services) => new KnowledgeRAGFlow(services),
});

// Extend global FlowTypeRegistry for type-safe flow creation
declare global {
	interface FlowTypeRegistry {
		"knowledge-rag": {
			services: AllServices;
			flow: KnowledgeRAGFlow;
		};
	}
}
