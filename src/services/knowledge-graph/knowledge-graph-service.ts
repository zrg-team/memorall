import { eq, and } from "drizzle-orm";
import { flowsService } from "@/services/flows/flows-service";
import { serviceManager } from "@/services";
import { logError, logInfo } from "@/utils/logger";
import type { RememberedContent } from "@/services/database/db";
import type {
	KnowledgeGraphData,
	ConversionProgress,
	ConversionStatus,
	KnowledgeGraphEntity,
	KnowledgeGraphRelation,
} from "@/types/knowledge-graph";
import type { KnowledgeGraphState } from "@/services/flows/graph/knowledge/state";

// Helper function to get URL from the new data structure
function getContentUrl(content: RememberedContent): string {
	if (content.sourceUrl) return content.sourceUrl;
	if (content.originalUrl) return content.originalUrl;
	return `content://${content.id}`;
}

export class KnowledgeGraphService {
	private static instance: KnowledgeGraphService;
	private conversions = new Map<string, ConversionProgress>();
	private listeners = new Set<
		(conversions: Map<string, ConversionProgress>) => void
	>();

	private constructor() {}

	static getInstance(): KnowledgeGraphService {
		if (!KnowledgeGraphService.instance) {
			KnowledgeGraphService.instance = new KnowledgeGraphService();
		}
		return KnowledgeGraphService.instance;
	}

	subscribe(
		listener: (conversions: Map<string, ConversionProgress>) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notifyListeners(): void {
		this.listeners.forEach((listener) => listener(this.conversions));
	}

	async getKnowledgeGraphForPage(
		pageId: string,
	): Promise<KnowledgeGraphData | null> {
		try {
			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Find source by remembered page URL
					const rememberedContent = await db
						.select()
						.from(schema.rememberedContent)
						.where(eq(schema.rememberedContent.id, pageId))
						.limit(1);

					if (rememberedContent.length === 0) {
						return null;
					}

					// Find sources created from this page
					const sources = await db
						.select()
						.from(schema.sources)
						.where(
							and(
								eq(schema.sources.targetType, "remembered_pages"),
								eq(schema.sources.targetId, pageId),
							),
						);

					if (sources.length === 0) {
						return null;
					}

					const source = sources[0];

					// Get all nodes created from this source
					const sourceNodesResult = await db
						.select({
							node: schema.nodes,
							sourceNode: schema.sourceNodes,
						})
						.from(schema.sourceNodes)
						.leftJoin(
							schema.nodes,
							eq(schema.sourceNodes.nodeId, schema.nodes.id),
						)
						.where(eq(schema.sourceNodes.sourceId, source.id));

					const entities: KnowledgeGraphEntity[] = sourceNodesResult
						.filter((result) => result.node)
						.map((result) => ({
							id: result.node!.id,
							name: result.node!.name,
							summary: result.node!.summary || undefined,
							nodeType: result.node!.nodeType,
							createdAt: result.node!.createdAt,
						}));

					// Get edges from source
					const sourceEdgesResult = await db
						.select({
							edge: schema.edges,
							sourceEdge: schema.sourceEdges,
						})
						.from(schema.sourceEdges)
						.leftJoin(
							schema.edges,
							eq(schema.sourceEdges.edgeId, schema.edges.id),
						)
						.where(eq(schema.sourceEdges.sourceId, source.id));

					// Get relations with node names
					const relations: KnowledgeGraphRelation[] = [];

					for (const result of sourceEdgesResult) {
						if (!result.edge) continue;

						// Get source and destination node names
						const sourceNode = await db
							.select()
							.from(schema.nodes)
							.where(eq(schema.nodes.id, result.edge.sourceId))
							.limit(1);

						const destinationNode = await db
							.select()
							.from(schema.nodes)
							.where(eq(schema.nodes.id, result.edge.destinationId))
							.limit(1);

						if (sourceNode.length > 0 && destinationNode.length > 0) {
							relations.push({
								id: result.edge.id,
								sourceNodeId: result.edge.sourceId,
								destinationNodeId: result.edge.destinationId,
								sourceName: sourceNode[0].name,
								destinationName: destinationNode[0].name,
								edgeType: result.edge.edgeType,
								factText: result.edge.factText || undefined,
								validAt: result.edge.validAt || undefined,
								invalidAt: result.edge.invalidAt || undefined,
								createdAt: result.edge.createdAt,
							});
						}
					}

					return {
						source,
						entities,
						relations,
					};
				},
			);

			return result;
		} catch (error) {
			logError("Failed to get knowledge graph for page:", error);
			return null;
		}
	}

	async convertPageToKnowledgeGraph(page: RememberedContent): Promise<void> {
		const conversionId = page.id;
		// Initialize conversion progress
		const conversion: ConversionProgress = {
			pageId: page.id,
			pageTitle: page.title,
			pageUrl: getContentUrl(page),
			status: "pending",
			stage: "Initializing...",
			progress: 0,
			startedAt: new Date(),
		};

		this.conversions.set(conversionId, conversion);
		this.notifyListeners();

		try {
			// Check if LLM service is ready
			if (!serviceManager.getLLMService().isReady()) {
				throw new Error("LLM service not ready");
			}

			// Update source status to processing
			await this.updateSourceStatus(page.id, "processing");

			this.updateConversion(conversionId, {
				status: "extracting_entities",
				stage: "Extracting entities...",
				progress: 10,
			});

			// Create knowledge graph flow
			const knowledgeGraph = flowsService.createGraph("knowledge", {
				llm: serviceManager.getLLMService(),
				embedding: serviceManager.getEmbeddingService(),
				database: serviceManager.getDatabaseService(),
			});

			// Prepare input state
			const initialState: Partial<KnowledgeGraphState> = {
				content: page.textContent,
				title: page.title,
				url: getContentUrl(page),
				pageId: page.id,
				referenceTimestamp: new Date().toISOString(),
				metadata: (page.sourceMetadata || {}) as Record<string, unknown>,
				currentMessage: `Title: ${page.title}\n\nContent:\n${page.textContent}`,
				sourceType: page.sourceType,
				previousMessages: undefined,
			};

			// Execute the knowledge graph flow with progress tracking
			const stream = await knowledgeGraph.stream(initialState);

			// Calculate stats
			const stats: {
				entitiesExtracted: number;
				entitiesResolved: number;
				factsExtracted: number;
				factsResolved: number;
				entitiesCreated: number;
				relationsCreated: number;
			} = {
				entitiesExtracted: 0,
				entitiesResolved: 0,
				factsExtracted: 0,
				factsResolved: 0,
				entitiesCreated: 0,
				relationsCreated: 0,
			};
			for await (const partial of stream) {
				const stepName = Object.keys(partial)[0];

				if (
					"extract_entities" in partial &&
					Array.isArray(partial.extract_entities.extractedEntities)
				) {
					stats.entitiesExtracted =
						partial.extract_entities.extractedEntities.length;
				} else if (
					"resolve_entities" in partial &&
					Array.isArray(partial.resolve_entities.resolvedEntities)
				) {
					stats.entitiesResolved =
						partial.resolve_entities.resolvedEntities.length;
				} else if (
					"extract_facts" in partial &&
					Array.isArray(partial.extract_facts.extractedFacts)
				) {
					stats.factsExtracted = partial.extract_facts.extractedFacts.length;
				} else if (
					"resolve_facts" in partial &&
					Array.isArray(partial.resolve_facts.resolvedFacts)
				) {
					stats.factsResolved = partial.resolve_facts.resolvedFacts.length;
				} else if (
					"save_to_database" in partial &&
					typeof partial.save_to_database === "object" &&
					partial.save_to_database.entitiesCreated
				) {
					if (Array.isArray(partial.save_to_database.entitiesCreated)) {
						stats.entitiesCreated =
							partial.save_to_database.entitiesCreated.length;
					}
					if (Array.isArray(partial.save_to_database.relationsCreated)) {
						stats.relationsCreated =
							partial.save_to_database.relationsCreated.length;
					}
				}

				// Update progress based on step
				let status: ConversionStatus = "pending";
				let stage = "Processing...";
				let progress = 20;

				switch (stepName) {
					case "load_entities":
						status = "loading_existing_data";
						stage = "Loading related entities...";
						progress = 25;
						break;
					case "extract_entities":
						status = "extracting_entities";
						stage = "Extracting entities...";
						progress = 30;
						break;
					case "resolve_entities":
						status = "resolving_entities";
						stage = "Resolving entities...";
						progress = 45;
						break;
					case "extract_facts":
						status = "extracting_facts";
						stage = "Extracting facts...";
						progress = 60;
						break;
					case "load_facts":
						status = "loading_existing_data";
						stage = "Loading related facts...";
						progress = 70;
						break;
					case "resolve_facts":
						status = "resolving_facts";
						stage = "Resolving facts...";
						progress = 75;
						break;
					case "extract_temporal":
						status = "extracting_temporal";
						stage = "Extracting temporal information...";
						progress = 85;
						break;
					case "save_to_database":
						status = "saving_to_database";
						stage = "Saving to database...";
						progress = 95;
						break;
				}

				this.updateConversion(conversionId, {
					status,
					stage,
					progress,
				});
			}

			// Update source status to completed
			await this.updateSourceStatus(page.id, "completed");

			this.updateConversion(conversionId, {
				status: "completed",
				stage: "Completed successfully",
				progress: 100,
				completedAt: new Date(),
				stats,
			});

			logInfo("Knowledge graph conversion completed:", {
				pageId: page.id,
				stats,
			});
		} catch (error) {
			logError("Knowledge graph conversion failed:", error);

			// Update source status to failed
			await this.updateSourceStatus(page.id, "failed");

			this.updateConversion(conversionId, {
				status: "failed",
				stage: "Failed",
				progress: 0,
				completedAt: new Date(),
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	private async updateSourceStatus(
		pageId: string,
		status: "pending" | "processing" | "completed" | "failed",
	): Promise<void> {
		try {
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const now = new Date();
				await db
					.update(schema.sources)
					.set({
						status,
						statusValidFrom: now,
						updatedAt: now,
					})
					.where(
						and(
							eq(schema.sources.targetType, "remembered_pages"),
							eq(schema.sources.targetId, pageId),
						),
					);
			});
			logInfo(`Source status updated to ${status} for page ${pageId}`);
		} catch (error) {
			logError(`Failed to update source status for page ${pageId}:`, error);
		}
	}

	private updateConversion(
		conversionId: string,
		updates: Partial<ConversionProgress>,
	): void {
		const existing = this.conversions.get(conversionId);
		if (existing) {
			this.conversions.set(conversionId, {
				...existing,
				...updates,
			});
			this.notifyListeners();
		}
	}

	async convertMultiplePages(pages: RememberedContent[]): Promise<void> {
		logInfo(`Starting batch conversion of ${pages.length} pages`);

		// Process pages sequentially to avoid overwhelming the LLM service
		for (const page of pages) {
			await this.convertPageToKnowledgeGraph(page);
			// Small delay between conversions
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	getConversion(pageId: string): ConversionProgress | undefined {
		return this.conversions.get(pageId);
	}

	getAllConversions(): ConversionProgress[] {
		return Array.from(this.conversions.values());
	}

	clearConversions(): void {
		this.conversions.clear();
		this.notifyListeners();
	}

	clearCompletedConversions(): void {
		for (const [key, conversion] of this.conversions.entries()) {
			if (conversion.status === "completed" || conversion.status === "failed") {
				this.conversions.delete(key);
			}
		}
		this.notifyListeners();
	}
}

export const knowledgeGraphService = KnowledgeGraphService.getInstance();
