import { END, START, StateGraph } from "@langchain/langgraph/web";
import { KnowledgeRAGAnnotation, type KnowledgeRAGState } from "./state";
import { GraphBase } from "@/services/flows/interfaces/graph.base";
import type { AllServices } from "@/services/flows/interfaces/tool";
import type { ChatCompletionResponse, ChatMessage } from "@/types/openai";
import { logError, logInfo } from "@/utils/logger";
import { eq, or, like, desc } from "drizzle-orm";
import type { Node, Edge } from "@/services/database/db";
import { trigramSearchNodes, trigramSearchEdges, combineSearchResultsWithTrigram } from "@/utils/trigram-search";

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

export class KnowledgeRAGFlow extends GraphBase<
	| "analyze_query"
	| "retrieve_knowledge"
	| "build_context"
	| "generate_response",
	KnowledgeRAGState,
	AllServices
> {
	constructor(services: AllServices) {
		super(services);
		this.workflow = new StateGraph(KnowledgeRAGAnnotation);

		// Add nodes
		this.workflow.addNode("analyze_query", this.analyzeQueryNode);
		this.workflow.addNode("retrieve_knowledge", this.retrieveKnowledgeNode);
		this.workflow.addNode("build_context", this.buildContextNode);
		this.workflow.addNode("generate_response", this.generateResponseNode);

		// Add edges
		this.workflow.addEdge(START, "analyze_query");
		this.workflow.addEdge("analyze_query", "retrieve_knowledge");
		this.workflow.addEdge("retrieve_knowledge", "build_context");
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
				max_tokens: 1024,
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;

			const responseContent = llmResponse.choices[0].message.content || "";
			logInfo("[KNOWLEDGE_RAG] Analysis response:", responseContent);

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
			logInfo(
				"[KNOWLEDGE_RAG] Retrieving knowledge for entities:",
				state.extractedEntities,
			);

			let relevantNodes: KnowledgeRAGState["relevantNodes"] = [];
			let relevantEdges: KnowledgeRAGState["relevantEdges"] = [];

			const TOTAL_NODE_LIMIT = 15;
			const TOTAL_EDGE_LIMIT = 20;
			const WEIGHTS = { sqlPercentage: 60, trigramPercentage: 40, vectorPercentage: 0 };

			// 1. SQL search for nodes
			const sqlNodes = await database.use(async ({ db, schema }) => {
				if (state.extractedEntities.length === 0) return [];

				const entitySearchConditions = state.extractedEntities.map((entity) =>
					or(
						like(schema.nodes.name, `%${entity}%`),
						like(schema.nodes.summary, `%${entity}%`),
					),
				);

				return await db
					.select({
						id: schema.nodes.id,
						nodeType: schema.nodes.nodeType,
						name: schema.nodes.name,
						summary: schema.nodes.summary,
						attributes: schema.nodes.attributes,
						groupId: schema.nodes.groupId,
						nameEmbedding: schema.nodes.nameEmbedding,
						createdAt: schema.nodes.createdAt,
						updatedAt: schema.nodes.updatedAt,
					})
					.from(schema.nodes)
					.where(or(...entitySearchConditions))
					.orderBy(desc(schema.nodes.createdAt))
					.limit(Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.sqlPercentage) / 100));
			});

			// 2. SQL search for edges
			const sqlEdges = await database.use(async ({ db, schema }) => {
				if (state.extractedEntities.length === 0) return [];

				const factSearchConditions = state.extractedEntities.map((entity) =>
					like(schema.edges.factText, `%${entity}%`),
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
						groupId: schema.edges.groupId,
						isCurrent: schema.edges.isCurrent,
						provenanceWeightCache: schema.edges.provenanceWeightCache,
						provenanceCountCache: schema.edges.provenanceCountCache,
						factEmbedding: schema.edges.factEmbedding,
						typeEmbedding: schema.edges.typeEmbedding,
						searchVector: schema.edges.searchVector,
						createdAt: schema.edges.createdAt,
						updatedAt: schema.edges.updatedAt,
					})
					.from(schema.edges)
					.where(or(...factSearchConditions))
					.orderBy(desc(schema.edges.createdAt))
					.limit(Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.sqlPercentage) / 100));
			});

			// 3. Trigram search for nodes
			let trigramNodeResults: Awaited<ReturnType<typeof trigramSearchNodes>> = [];
			if (state.extractedEntities.length > 0) {
				try {
					trigramNodeResults = await trigramSearchNodes(
						database,
						state.extractedEntities,
						Math.floor((TOTAL_NODE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 }
					);
				} catch (error) {
					logError("[KNOWLEDGE_RAG] Trigram search for nodes failed:", error);
				}
			}

			// 4. Trigram search for edges
			let trigramEdgeResults: Awaited<ReturnType<typeof trigramSearchEdges>> = [];
			if (state.extractedEntities.length > 0) {
				try {
					trigramEdgeResults = await trigramSearchEdges(
						database,
						state.extractedEntities,
						Math.floor((TOTAL_EDGE_LIMIT * WEIGHTS.trigramPercentage) / 100),
						{ threshold: 0.1 }
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

			if ((combinedNodeResults < TOTAL_NODE_LIMIT * 0.5 || combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) && embedding) {
				logInfo("[KNOWLEDGE_RAG] Insufficient results from SQL/trigram, falling back to vector search");

				try {
					// Generate embedding for search terms
					const searchText = state.extractedEntities.join(" ");
					const searchEmbedding = await embedding.textToVector(searchText);

					// Vector search for nodes
					if (combinedNodeResults < TOTAL_NODE_LIMIT * 0.5) {
						const vectorNodeResults = await database.use(async ({ raw }) => {
							const query = `
								SELECT *,
									1 - (name_embedding <=> $1::vector) as similarity
								FROM nodes
								WHERE name_embedding IS NOT NULL
								ORDER BY similarity DESC
								LIMIT $2
							`;
							const nodeLimit = Math.min(TOTAL_NODE_LIMIT - combinedNodeResults, Math.floor(TOTAL_NODE_LIMIT * 0.4));
							const result = await raw(query, [
								JSON.stringify(searchEmbedding),
								nodeLimit,
							]);
							return (result as { rows: NodeWithSimilarity[] })?.rows || [];
						});
						vectorNodes = vectorNodeResults;
					}

					// Vector search for edges
					if (combinedEdgeResults < TOTAL_EDGE_LIMIT * 0.5) {
						const vectorEdgeResults = await database.use(async ({ raw }) => {
							const query = `
								SELECT *,
									1 - (fact_embedding <=> $1::vector) as similarity
								FROM edges
								WHERE fact_embedding IS NOT NULL
								ORDER BY similarity DESC
								LIMIT $2
							`;
							const edgeLimit = Math.min(TOTAL_EDGE_LIMIT - combinedEdgeResults, Math.floor(TOTAL_EDGE_LIMIT * 0.4));
							const result = await raw(query, [
								JSON.stringify(searchEmbedding),
								edgeLimit,
							]);
							return (result as { rows: EdgeWithSimilarity[] })?.rows || [];
						});
						vectorEdges = vectorEdgeResults;
					}
				} catch (embeddingError) {
					logError("[KNOWLEDGE_RAG] Vector search fallback failed:", embeddingError);
				}
			}

			// 6. Combine results using trigram combiner
			const combinedNodes = combineSearchResultsWithTrigram(
				sqlNodes,
				vectorNodes.map(node => ({ item: node, similarity: (node as any).similarity || 0 })),
				trigramNodeResults,
				WEIGHTS,
				TOTAL_NODE_LIMIT,
				(node) => node.id,
			);

			const combinedEdges = combineSearchResultsWithTrigram(
				sqlEdges,
				vectorEdges.map(edge => ({ item: edge, similarity: (edge as any).similarity || 0 })),
				trigramEdgeResults,
				WEIGHTS,
				TOTAL_EDGE_LIMIT,
				(edge) => edge.id,
			);

			// 4. Process and score nodes
			relevantNodes = combinedNodes.map((node) => {
				let relevanceScore = 0;

				// Text-based relevance
				state.extractedEntities.forEach((entity) => {
					const entityLower = entity.toLowerCase();
					if (node.name.toLowerCase().includes(entityLower)) {
						relevanceScore += 3;
					}
					if (node.summary?.toLowerCase().includes(entityLower)) {
						relevanceScore += 2;
					}
				});

				return {
					id: node.id,
					nodeType: node.nodeType,
					name: node.name,
					summary: node.summary || "",
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
						.where(or(...missingNodeIds.map((id) => eq(schema.nodes.id, id))));
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
				const sourceRelevant = allNodeIds.includes(edge.sourceId);
				const destRelevant = allNodeIds.includes(edge.destinationId);
				if (sourceRelevant && destRelevant) {
					relevanceScore += 3;
				} else if (sourceRelevant || destRelevant) {
					relevanceScore += 1;
				}

				return {
					id: edge.id,
					sourceId: edge.sourceId,
					destinationId: edge.destinationId,
					edgeType: edge.edgeType,
					factText: edge.factText || "",
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
				.map((node) => `${node.name}: ${node.summary}`)
				.join(", ");

			// 2. Build facts section - entity connections with fact text
			const facts = state.relevantEdges
				.map((edge) => {
					const sourceName =
						state.relevantNodes.find((n) => n.id === edge.sourceId)?.name ||
						"Unknown";
					const destName =
						state.relevantNodes.find((n) => n.id === edge.destinationId)
							?.name || "Unknown";
					return `${sourceName} ${edge.edgeType} ${destName}, ${edge.factText}`;
				})
				.join(". ");

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
						name: "Context Building",
						description: `\n\`\`\`mermaid\n${mermaidDiagram}\n\`\`\`\n`,
						metadata: {
							definitionsCount: state.relevantNodes.length,
							factsCount: state.relevantEdges.length,
							hasMermaid: true,
						},
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

			logInfo(
				"[KNOWLEDGE_RAG] Generated response:",
				responseContent.substring(0, 200) + "...",
			);

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
}
