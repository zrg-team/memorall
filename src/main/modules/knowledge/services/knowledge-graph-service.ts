import { eq, and } from "drizzle-orm";
import { serviceManager } from "@/services";
import { logError, logInfo } from "@/utils/logger";
import type {
	KnowledgeGraphData,
	ConversionProgress,
	ConversionStatus,
	KnowledgeGraphEntity,
	KnowledgeGraphRelation,
} from "@/types/knowledge-graph";
import type { KnowledgeGraphState } from "@/services/flows/graph/knowledge/state";
import type { StructMemState } from "@/services/flows/graph/structmem/state";
import {
	DEFAULT_GROW_TYPE,
	type GrowType,
} from "@/services/database/entities/topic-types";
import { isUuid } from "@/utils/uuid";
import { consoleFlowLogger } from "@/services/flows/interfaces/logger";
import {
	toFlowDatabase,
	toFlowEmbedding,
	toFlowLLM,
	toFlowSandbox,
} from "@/services/flow-service-adapters";

export type KnowledgeGrowMode = "knowledge" | "structmem";

const growTypeToMode = (growType: GrowType): KnowledgeGrowMode =>
	growType === "structmem" ? "structmem" : "knowledge";

export class KnowledgeGraphService {
	private static instance: KnowledgeGraphService;
	private conversions = new Map<string, ConversionProgress>();
	private listeners = new Set<
		(conversions: Map<string, ConversionProgress>) => void
	>();

	private constructor() {}

	/**
	 * Helper to safely convert topicId to graph value
	 * Handles undefined, null, and empty strings consistently
	 */
	private getGraphValue(topicId?: string): string {
		// check topicId is uuid too
		if (topicId && topicId.trim().length > 0 && isUuid(topicId.trim())) {
			return `${topicId.trim()}`;
		}
		return "";
	}

	private async resolveGrowModeForTopic(
		topicId: string | undefined,
		fallback: KnowledgeGrowMode,
	): Promise<KnowledgeGrowMode> {
		if (!topicId || topicId === "default") return fallback;

		try {
			const topic = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const rows = await db
						.select({ growType: schema.topics.growType })
						.from(schema.topics)
						.where(eq(schema.topics.id, topicId))
						.limit(1);
					return rows[0] ?? null;
				},
			);
			return growTypeToMode(topic?.growType ?? DEFAULT_GROW_TYPE);
		} catch (error) {
			logError("Failed to resolve topic grow mode:", error);
			return fallback;
		}
	}

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
		filePath: string,
	): Promise<KnowledgeGraphData | null> {
		try {
			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Find sources created from this page
					const sources = await db
						.select()
						.from(schema.sources)
						.where(
							and(
								eq(schema.sources.targetType, "file"),
								eq(schema.sources.targetId, filePath),
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

	async convertPageToKnowledgeGraph(
		filePath: string,
		content: string,
		topicId?: string,
		isSpecificTextConversion?: boolean,
		growMode: KnowledgeGrowMode = "knowledge",
	): Promise<void> {
		const conversionId = filePath;
		const effectiveGrowMode = await this.resolveGrowModeForTopic(
			topicId,
			growMode,
		);
		// Initialize conversion progress
		const conversion: ConversionProgress = {
			pageId: filePath, // Keep as pageId for ConversionProgress interface compatibility
			pageTitle: filePath,
			pageUrl: filePath,
			status: "pending",
			stage: "Initializing...",
			progress: 0,
			startedAt: new Date(),
		};

		this.conversions.set(conversionId, conversion);
		this.notifyListeners();

		let sourceId: string | undefined;

		try {
			// Check if LLM service is ready
			if (!serviceManager.getLLMService().isReady()) {
				throw new Error("LLM service not ready");
			}

			// Create source record for this file (for knowledge graph tracking)
			sourceId = await this.ensureSourceWithProcessingStatus(filePath, {
				title: filePath,
				topicId: topicId, // Use the provided topicId (undefined for default)
				sourceType: "file",
				sourceUrl: filePath,
				growMode: effectiveGrowMode,
			});

			this.updateConversion(conversionId, {
				status: "extracting_entities",
				stage:
					effectiveGrowMode === "structmem"
						? "Extracting StructMem event entries..."
						: "Extracting entities...",
				progress: 10,
			});

			const services = {
				llm: toFlowLLM(serviceManager.getLLMService()),
				embedding: toFlowEmbedding(serviceManager.getEmbeddingService()),
				database: toFlowDatabase(serviceManager.getDatabaseService()),
				logger: consoleFlowLogger,
				sandboxContainer: toFlowSandbox(
					serviceManager.getSandboxContainerService(),
				),
			};

			const baseState = {
				content: content,
				title: filePath,
				url: filePath,
				graphId: topicId,
				sourceId: sourceId,
				referenceTimestamp: new Date().toISOString(),
				metadata: { growMode: effectiveGrowMode } as Record<string, unknown>,
				currentMessage: `File: ${filePath}\n\nContent:\n${content}`,
				sourceType: "file",
				previousMessages: undefined,
			};

			const stream =
				effectiveGrowMode === "structmem"
					? await serviceManager.flowsService
							.createGraph("structmem", services)
							.stream(baseState satisfies Partial<StructMemState>)
					: await serviceManager.flowsService
							.createGraph("knowledge", services)
							.stream({
								...baseState,
								isSpecificTextConversion,
							} satisfies Partial<KnowledgeGraphState>);

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
					case "extract_event":
						status = "extracting_entities";
						stage = "Extracting StructMem event entries...";
						progress = 30;
						break;
					case "save_event_entries":
						status = "saving_to_database";
						stage = "Saving StructMem event memory...";
						progress = 55;
						break;
					case "load_related_events":
						status = "loading_existing_data";
						stage = "Loading related StructMem events...";
						progress = 70;
						break;
					case "consolidate_events":
						status = "extracting_facts";
						stage = "Consolidating StructMem memory...";
						progress = 85;
						break;
					case "save_consolidation":
						status = "saving_to_database";
						stage = "Saving StructMem synthesis memory...";
						progress = 95;
						break;
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
			await this.updateSourceStatus(sourceId, "completed");

			this.updateConversion(conversionId, {
				status: "completed",
				stage: "Completed successfully",
				progress: 100,
				completedAt: new Date(),
				stats,
			});

			logInfo("Knowledge graph conversion completed:", {
				filePath: filePath,
				growMode: effectiveGrowMode,
				stats,
			});
		} catch (error) {
			logError("Knowledge graph conversion failed:", error);

			// Update source status to failed (if sourceId was created)
			if (sourceId) {
				await this.updateSourceStatus(sourceId, "failed");
			}

			this.updateConversion(conversionId, {
				status: "failed",
				stage: "Failed",
				progress: 0,
				completedAt: new Date(),
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	}

	/**
	 * Create source record for a page with pending status
	 * This is called when content is first saved
	 */
	async createSourceForPage(
		filePath: string,
		options: {
			title: string;
			topicId?: string;
			sourceType?: string;
			sourceUrl?: string;
			growMode?: KnowledgeGrowMode;
		},
	): Promise<string> {
		try {
			const graphValue = this.getGraphValue(options.topicId);
			const sourceId = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const [source] = await db
						.insert(schema.sources)
						.values({
							targetType: "file",
							targetId: filePath,
							name: options.title,
							status: "pending",
							statusValidFrom: new Date(),
							metadata: {
								sourceType: options.sourceType,
								sourceUrl: options.sourceUrl,
								topicId: options.topicId,
								growMode: options.growMode ?? "knowledge",
							},
							referenceTime: new Date(),
							graph: graphValue,
						})
						.returning();
					return source.id;
				},
			);
			logInfo(
				`Source created with pending status for file ${filePath} with graph ${graphValue}`,
			);
			return sourceId;
		} catch (error) {
			logError(`Failed to create source for file ${filePath}:`, error);
			throw error;
		}
	}

	/**
	 * Ensure source exists and set to processing status
	 * Creates source if it doesn't exist, or updates existing source
	 * NOTE: A file can have multiple sources (one per topicId/graph)
	 */
	private async ensureSourceWithProcessingStatus(
		filePath: string,
		options: {
			title: string;
			topicId?: string;
			sourceType?: string;
			sourceUrl?: string;
			growMode?: KnowledgeGrowMode;
		},
	): Promise<string> {
		try {
			const graphValue = this.getGraphValue(options.topicId);

			return await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Check if source exists for this file AND graph combination
					const existing = await db
						.select()
						.from(schema.sources)
						.where(
							and(
								eq(schema.sources.targetType, "file"),
								eq(schema.sources.targetId, filePath),
								eq(schema.sources.graph, graphValue),
							),
						)
						.limit(1);

					const now = new Date();

					if (existing && existing.length > 0) {
						// Update existing source to processing
						await db
							.update(schema.sources)
							.set({
								status: "processing",
								statusValidFrom: now,
								updatedAt: now,
							})
							.where(eq(schema.sources.id, existing[0].id));
						logInfo(
							`Source updated to processing for file ${filePath} with graph ${graphValue}`,
						);
						return existing[0].id;
					} else {
						// Create new source with processing status
						const [source] = await db
							.insert(schema.sources)
							.values({
								targetType: "file",
								targetId: filePath,
								name: options.title,
								status: "processing",
								statusValidFrom: now,
								metadata: {
									sourceType: options.sourceType,
									sourceUrl: options.sourceUrl,
									topicId: options.topicId,
									growMode: options.growMode ?? "knowledge",
								},
								referenceTime: now,
								graph: graphValue,
							})
							.returning();
						logInfo(
							`Source created with processing status for file ${filePath} with graph ${graphValue}`,
						);
						return source.id;
					}
				},
			);
		} catch (error) {
			logError(`Failed to ensure source for file ${filePath}:`, error);
			throw error;
		}
	}

	private async updateSourceStatus(
		sourceId: string,
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
					.where(eq(schema.sources.id, sourceId));
			});
			logInfo(`Source status updated to ${status} for source ${sourceId}`);
		} catch (error) {
			logError(`Failed to update source status for source ${sourceId}:`, error);
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

	async convertMultiplePages(
		files: Array<{ filePath: string; content: string }>,
	): Promise<void> {
		logInfo(`Starting batch conversion of ${files.length} files`);

		// Process files sequentially to avoid overwhelming the LLM service
		for (const file of files) {
			await this.convertPageToKnowledgeGraph(file.filePath, file.content);
			// Small delay between conversions
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	getConversion(filePath: string): ConversionProgress | undefined {
		return this.conversions.get(filePath);
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
