import { desc, eq, like, and, or } from "drizzle-orm";
import { logError, logInfo } from "@/utils/logger";
import { persistentLogger } from "@/services/logging/persistent-logger";
import { serviceManager } from '@/services'
import { flowsService } from "@/services/flows/flows-service";
import type { RememberedContent } from "@/services/database/db";
import type {
	PageMetadata,
	ReadabilityArticle,
	RememberThisResponse,
	SelectionMetadata,
	UserInputMetadata,
} from "@/types/remember-this";
import type { KnowledgeGraphState } from "@/services/flows/graph/knowledge/state";

export interface SavePageData {
	html: string;
	url: string;
	title: string;
	metadata: PageMetadata;
	article: ReadabilityArticle;
}

export interface SaveContentData {
	sourceType:
		| "webpage"
		| "selection"
		| "user_input"
		| "user"
		| "raw_text"
		| "file_upload";
	sourceUrl?: string;
	originalUrl?: string;
	title: string;
	rawContent: string;
	cleanContent: string;
	textContent: string;
	sourceMetadata: PageMetadata | SelectionMetadata | UserInputMetadata;
	extractionMetadata: ReadabilityArticle | Record<string, unknown>;
}

export interface SearchOptions {
	query?: string;
	tags?: string[];
	isArchived?: boolean;
	isFavorite?: boolean;
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "updatedAt" | "title" | "contentLength";
	sortOrder?: "asc" | "desc";
}

export interface SearchResult {
	pages: RememberedContent[];
	total: number;
	hasMore: boolean;
}

export class RememberService {
	private static instance: RememberService;
	private initialized = false;

	private constructor() {}

	static getInstance(): RememberService {
		if (!RememberService.instance) {
			RememberService.instance = new RememberService();
		}
		return RememberService.instance;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			this.initialized = true;
			logInfo("✅ RememberService initialized successfully");
		} catch (error) {
			logError("❌ RememberService initialization failed:", error);
			throw error;
		}
	}

	/**
	 * Save a remembered page to the database with knowledge graph processing
	 */
	async savePage(data: SavePageData): Promise<RememberThisResponse> {
		let basicResponse: RememberThisResponse;

		try {
			if (!this.initialized) {
				await this.initialize();
			}

			logInfo("🔄 Processing page, saving to DB first:", data.url);

			// ALWAYS save the basic page data first, regardless of any other failures
			basicResponse = await this.savePageBasic(data);
			if (!basicResponse.success) {
				return basicResponse;
			}

			logInfo(
				"✅ Page saved to DB, now attempting knowledge graph processing:",
				data.url,
			);
		} catch (error) {
			logError("❌ Failed to save basic page data:", error);
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to save page to database",
			};
		}

		// Process knowledge graph in background - processKnowledgeGraph handles its own errors
		// and never throws, so this is safe to call
		if (!basicResponse.pageId) {
			logError("❌ No pageId available for knowledge graph processing", {
				basicResponse,
			});
			return basicResponse;
		}

		logInfo(
			"🔄 Starting knowledge graph processing with pageId:",
			basicResponse.pageId,
		);
		await this.processKnowledgeGraph(data, basicResponse.pageId);
		logInfo(
			"✅ Knowledge graph processing completed (or skipped with errors logged):",
			data.url,
		);

		return basicResponse;
	}

	/**
	 * Save content directly (for selections, user input, etc.)
	 */
	async saveContentDirect(
		data: SaveContentData,
	): Promise<RememberThisResponse> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			logInfo("🔄 Saving content directly:", data.sourceType);

			// Generate embedding for semantic search (skip in Service Worker context)
			let embedding: number[] | undefined;
			// Check if we're in Service Worker context (no DOM access)
			const isServiceWorker =
				typeof window === "undefined" && typeof document === "undefined";
			if (!isServiceWorker) {
				try {
					const embeddingText = `${data.title}\n\n${data.textContent}`;
					embedding = await serviceManager.embeddingService.textToVector(embeddingText);
				} catch (embeddingError) {
					logError(
						"⚠️ Failed to generate embedding, continuing without it:",
						embeddingError,
					);
				}
			} else {
				logInfo("ℹ️ Skipping embedding generation in Service Worker context");
			}

			// Calculate content quality metrics
			const contentLength = data.textContent.length;
			const readabilityScore =
				data.sourceType === "webpage"
					? this.calculateReadabilityScore(
							data.extractionMetadata as ReadabilityArticle,
						)
					: this.calculateBasicScore(data.textContent);

			// Create search vector for full-text search
			const searchVector = this.createSearchVectorGeneric(
				data.title,
				data.textContent,
				data.sourceMetadata,
			);

			// Prepare data for insertion using new schema
			const newContent = {
				sourceType: data.sourceType,
				sourceUrl: data.sourceUrl,
				originalUrl: data.originalUrl,
				title: data.title,
				rawContent: data.rawContent,
				cleanContent: data.cleanContent,
				textContent: data.textContent,
				sourceMetadata: data.sourceMetadata as any,
				extractionMetadata: data.extractionMetadata as any,
				embedding,
				searchVector,
				tags: [],
				contentLength,
				readabilityScore,
				isArchived: false,
				isFavorite: false,
			};

			// Save to database
			const result = await serviceManager.databaseService.use(async ({ db, schema }) => {
				const [savedContent] = await db
					.insert(schema.rememberedContent)
					.values(newContent)
					.returning();
				return savedContent;
			});

			logInfo("✅ Content saved successfully:", result.id);

			// For non-webpage content, optionally process through knowledge graph
			if (data.sourceType !== "webpage" && data.textContent.length > 100) {
				logInfo(
					"🧠 Processing non-webpage content through knowledge graph:",
					result.id,
				);
				await this.processKnowledgeGraphGeneric(data, result.id);
			}

			return {
				success: true,
				pageId: result.id,
			};
		} catch (error) {
			logError("❌ Failed to save content directly:", error);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to save content",
			};
		}
	}

	/**
	 * Transform legacy SavePageData to new SaveContentData format
	 */
	private transformLegacyData(data: SavePageData): SaveContentData {
		return {
			sourceType: "webpage",
			sourceUrl: data.url,
			originalUrl: undefined,
			title: data.title,
			rawContent: data.html,
			cleanContent: data.article.content,
			textContent: data.article.textContent,
			sourceMetadata: data.metadata,
			extractionMetadata: data.article,
		};
	}

	/**
	 * Save a remembered page to the database (basic functionality without knowledge graph)
	 */
	async savePageBasic(data: SavePageData): Promise<RememberThisResponse> {
		try {
			// Transform legacy data to new format and delegate to saveContentDirect
			const contentData = this.transformLegacyData(data);
			return await this.saveContentDirect(contentData);
		} catch (error) {
			logError("❌ Failed to save remembered page:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to save page",
			};
		}
	}

	/**
	 * Update an existing remembered page
	 */
	async updatePage(
		pageId: string,
		data: SavePageData,
	): Promise<RememberThisResponse> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			// Transform legacy data to new format
			const contentData = this.transformLegacyData(data);

			// Generate new embedding if content changed (skip in Service Worker context)
			let embedding: number[] | undefined;
			// Check if we're in Service Worker context (no DOM access)
			const isServiceWorker =
				typeof window === "undefined" && typeof document === "undefined";
			if (!isServiceWorker) {
				try {
					const embeddingText = `${contentData.title}\n\n${contentData.textContent}`;
					embedding = await serviceManager.embeddingService.textToVector(embeddingText);
				} catch (embeddingError) {
					logError(
						"⚠️ Failed to generate embedding for update:",
						embeddingError,
					);
				}
			} else {
				logInfo(
					"ℹ️ Skipping embedding generation in Service Worker context for update",
				);
			}

			const contentLength = contentData.textContent.length;
			const readabilityScore = this.calculateReadabilityScore(data.article);
			const searchVector = this.createSearchVectorGeneric(
				contentData.title,
				contentData.textContent,
				contentData.sourceMetadata,
			);

			const result = await serviceManager.databaseService.use(async ({ db, schema }) => {
				const [updatedPage] = await db
					.update(schema.rememberedContent)
					.set({
						sourceType: contentData.sourceType,
						sourceUrl: contentData.sourceUrl,
						originalUrl: contentData.originalUrl,
						title: contentData.title,
						rawContent: contentData.rawContent,
						cleanContent: contentData.cleanContent,
						textContent: contentData.textContent,
						sourceMetadata: contentData.sourceMetadata as any,
						extractionMetadata: contentData.extractionMetadata as any,
						embedding,
						searchVector,
						contentLength,
						readabilityScore,
						updatedAt: new Date(),
					})
					.where(eq(schema.rememberedContent.id, pageId))
					.returning();
				return updatedPage;
			});

			logInfo("✅ Page updated successfully:", pageId);

			return {
				success: true,
				pageId,
			};
		} catch (error) {
			logError("❌ Failed to update remembered page:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to update page",
			};
		}
	}

	/**
	 * Find a page by URL
	 */
	async findByUrl(url: string): Promise<RememberedContent | null> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const result = await serviceManager.databaseService.use(async ({ db, schema }) => {
				const pages = await db
					.select()
					.from(schema.rememberedContent)
					.where(eq(schema.rememberedContent.sourceUrl, url))
					.limit(1);
				return pages[0] || null;
			});

			return result;
		} catch (error) {
			logError("❌ Failed to find page by URL:", error);
			return null;
		}
	}

	/**
	 * Search remembered pages
	 */
	async searchPages(options: SearchOptions = {}): Promise<SearchResult> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const {
				query = "",
				tags = [],
				isArchived,
				isFavorite,
				limit = 20,
				offset = 0,
				sortBy = "createdAt",
				sortOrder = "desc",
			} = options;

			const result = await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Build where conditions
				const conditions = [];

				if (query.trim()) {
					conditions.push(
						or(
							like(schema.rememberedContent.title, `%${query}%`),
							like(schema.rememberedContent.textContent, `%${query}%`),
							like(schema.rememberedContent.searchVector, `%${query}%`),
						),
					);
				}

				if (tags.length > 0) {
					// PostgreSQL JSONB array contains check
					conditions.push(
						// This would need proper JSONB query syntax in production
						like(schema.rememberedContent.tags as any, `%${tags[0]}%`),
					);
				}

				if (isArchived !== undefined) {
					conditions.push(eq(schema.rememberedContent.isArchived, isArchived));
				}

				if (isFavorite !== undefined) {
					conditions.push(eq(schema.rememberedContent.isFavorite, isFavorite));
				}

				const whereClause =
					conditions.length > 0 ? and(...conditions) : undefined;

				// Build order by
				const column = schema.rememberedContent[sortBy];
				const orderBy = sortOrder === "desc" ? desc(column) : column;

				// Get total count
				const totalQuery = db
					.select({ count: schema.rememberedContent.id })
					.from(schema.rememberedContent);
				if (whereClause) {
					totalQuery.where(whereClause);
				}

				// Get pages
				const pagesQuery = db.select().from(schema.rememberedContent);
				if (whereClause) {
					pagesQuery.where(whereClause);
				}
				pagesQuery.orderBy(orderBy).limit(limit).offset(offset);

				const [totalResult, pages] = await Promise.all([
					totalQuery,
					pagesQuery,
				]);

				const total = totalResult.length;
				const hasMore = offset + limit < total;

				return { pages, total, hasMore };
			});

			return result;
		} catch (error) {
			logError("❌ Failed to search pages:", error);
			return { pages: [], total: 0, hasMore: false };
		}
	}

	/**
	 * Get a page by ID
	 */
	async getPageById(id: string): Promise<RememberedContent | null> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const result = await serviceManager.databaseService.use(async ({ db, schema }) => {
				const pages = await db
					.select()
					.from(schema.rememberedContent)
					.where(eq(schema.rememberedContent.id, id))
					.limit(1);
				return pages[0] || null;
			});

			return result;
		} catch (error) {
			logError("❌ Failed to get page by ID:", error);
			return null;
		}
	}

	/**
	 * Delete a page
	 */
	async deletePage(id: string): Promise<boolean> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db
					.delete(schema.rememberedContent)
					.where(eq(schema.rememberedContent.id, id));
			});

			logInfo("✅ Page deleted successfully:", id);
			return true;
		} catch (error) {
			logError("❌ Failed to delete page:", error);
			return false;
		}
	}

	/**
	 * Toggle favorite status
	 */
	async toggleFavorite(id: string): Promise<boolean> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const page = await this.getPageById(id);
			if (!page) return false;

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db
					.update(schema.rememberedContent)
					.set({
						isFavorite: !page.isFavorite,
						updatedAt: new Date(),
					})
					.where(eq(schema.rememberedContent.id, id));
			});

			return true;
		} catch (error) {
			logError("❌ Failed to toggle favorite:", error);
			return false;
		}
	}

	/**
	 * Toggle archive status
	 */
	async toggleArchive(id: string): Promise<boolean> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const page = await this.getPageById(id);
			if (!page) return false;

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db
					.update(schema.rememberedContent)
					.set({
						isArchived: !page.isArchived,
						updatedAt: new Date(),
					})
					.where(eq(schema.rememberedContent.id, id));
			});

			return true;
		} catch (error) {
			logError("❌ Failed to toggle archive:", error);
			return false;
		}
	}

	/**
	 * Add tags to a page
	 */
	async addTags(id: string, newTags: string[]): Promise<boolean> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const page = await this.getPageById(id);
			if (!page) return false;

			const currentTags = Array.isArray(page.tags) ? page.tags : [];
			const updatedTags = [...new Set([...currentTags, ...newTags])];

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db
					.update(schema.rememberedContent)
					.set({
						tags: updatedTags as any,
						updatedAt: new Date(),
					})
					.where(eq(schema.rememberedContent.id, id));
			});

			return true;
		} catch (error) {
			logError("❌ Failed to add tags:", error);
			return false;
		}
	}

	/**
	 * Calculate a simple readability score
	 */
	private calculateReadabilityScore(article: ReadabilityArticle): number {
		const textLength = article.textContent.length;
		const contentLength = article.content.length;

		if (textLength === 0) return 0;

		// Simple heuristic: ratio of text to HTML, adjusted by length
		const textToHtmlRatio = textLength / Math.max(contentLength, 1);
		const lengthScore = Math.min(textLength / 5000, 1); // Normalize to 5k chars

		return Math.round((textToHtmlRatio * 0.7 + lengthScore * 0.3) * 100) / 100;
	}

	/**
	 * Create a search vector for full-text search
	 */
	private createSearchVector(
		title: string,
		textContent: string,
		metadata: PageMetadata,
	): string {
		const parts = [
			title,
			textContent.substring(0, 1000), // First 1k chars
			metadata.description || "",
			metadata.domain,
		];

		return parts
			.join(" ")
			.toLowerCase()
			.replace(/[^\w\s]/g, " ");
	}

	/**
	 * Create a search vector for any content type
	 */
	private createSearchVectorGeneric(
		title: string,
		textContent: string,
		metadata: any,
	): string {
		const parts = [
			title,
			textContent.substring(0, 1000), // First 1k chars
		];

		// Add metadata-specific searchable content
		if (metadata.description) parts.push(metadata.description);
		if (metadata.domain) parts.push(metadata.domain);
		if (metadata.pageTitle && metadata.pageTitle !== title)
			parts.push(metadata.pageTitle);
		if (metadata.context) parts.push(metadata.context);

		return parts
			.join(" ")
			.toLowerCase()
			.replace(/[^\w\s]/g, " ");
	}

	/**
	 * Calculate a basic score for non-webpage content
	 */
	private calculateBasicScore(textContent: string): number {
		const length = textContent.length;
		if (length === 0) return 0;

		// Simple scoring based on length and structure
		const lengthScore = Math.min(length / 1000, 1); // Normalize to 1k chars
		const hasStructure = textContent.includes("\n") ? 0.2 : 0;
		const hasVariety = /[.,!?]/.test(textContent) ? 0.3 : 0;

		return (
			Math.round((lengthScore * 0.5 + hasStructure + hasVariety) * 100) / 100
		);
	}

	/**
	 * Process page content through knowledge graph flow
	 */
	private async processKnowledgeGraph(
		data: SavePageData,
		pageId: string,
	): Promise<void> {
		try {
			await persistentLogger.info(
				"🧠 Starting knowledge graph processing",
				{
					url: data.url,
					title: data.title,
					pageId: pageId,
					contentLength: data.article.textContent.length,
				},
				"background",
			);

			logInfo("🧠 Processing content through knowledge graph flow");

			// Check if LLM service is ready
			if (!serviceManager.llmService.isReady()) {
				await persistentLogger.warn(
					"❌ LLM service not ready, skipping knowledge graph processing",
					{
						url: data.url,
						llmReady: serviceManager.llmService.isReady(),
					},
					"background",
				);

				logError(
					"❌ LLM service not ready, skipping knowledge graph processing",
				);
				return;
			}

			await persistentLogger.info(
				"✅ LLM service ready, proceeding with knowledge graph",
				{
					url: data.url,
					llmReady: serviceManager.llmService.isReady(),
				},
				"background",
			);

			// Create knowledge graph flow
			const knowledgeGraph = flowsService.createGraph("knowledge", {
				llm: serviceManager.llmService,
				embedding: serviceManager.embeddingService,
				database: serviceManager.databaseService,
			});

			await persistentLogger.info(
				"🔧 Knowledge graph flow created",
				{
					url: data.url,
				},
				"background",
			);

			// Prepare input state
			const initialState: Partial<KnowledgeGraphState> = {
				content: data.article.textContent,
				title: data.title,
				url: data.url,
				pageId: pageId,
				referenceTimestamp: new Date().toISOString(),
				metadata: data.metadata as unknown as Record<string, unknown>,
				currentMessage: `Title: ${data.title}\n\nContent:\n${data.article.textContent}`,
				previousMessages: undefined,
			};

			logInfo("🔧 Knowledge graph initial state prepared", {
				url: data.url,
				pageId: pageId,
				hasPageId: !!pageId,
			});

			await persistentLogger.info(
				"🚀 Executing knowledge graph flow",
				{
					url: data.url,
					contentPreview: data.article.textContent.substring(0, 200) + "...",
				},
				"background",
			);

			if (!pageId) {
				throw new Error("Error");
			}

			// Execute the knowledge graph flow
			const result = await knowledgeGraph.invoke(initialState);

			const stats = {
				url: data.url,
				nodesCreated: Array.isArray(result.createdNodes)
					? result.createdNodes.length
					: 0,
				edgesCreated: Array.isArray(result.createdEdges)
					? result.createdEdges.length
					: 0,
				sourceId: (result.createdSource as any)?.id || "unknown",
				errors: Array.isArray(result.errors) ? result.errors.length : 0,
				entitiesExtracted: Array.isArray(result.extractedEntities)
					? result.extractedEntities.length
					: 0,
				factsExtracted: Array.isArray(result.extractedFacts)
					? result.extractedFacts.length
					: 0,
			};

			await persistentLogger.info(
				"✅ Knowledge graph processing completed successfully",
				stats,
				"background",
			);

			logInfo("✅ Knowledge graph processing completed:", stats);

			if (Array.isArray(result.errors) && result.errors.length > 0) {
				await persistentLogger.warn(
					"⚠️ Knowledge graph processing had errors",
					{
						url: data.url,
						errors: result.errors,
					},
					"background",
				);

				logError("⚠️ Knowledge graph processing had errors:", result.errors);
			}
		} catch (error) {
			await persistentLogger.error(
				"❌ Failed to process knowledge graph",
				{
					url: data.url,
					error: error instanceof Error ? error.message : "Unknown error",
					stack: error instanceof Error ? error.stack : undefined,
				},
				"background",
			);

			logError("❌ Failed to process knowledge graph:", error);
			// Don't throw error - knowledge graph processing is optional
		}
	}

	/**
	 * Process generic content through knowledge graph flow
	 */
	private async processKnowledgeGraphGeneric(
		data: SaveContentData,
		contentId: string,
	): Promise<void> {
		try {
			logInfo("🧠 Processing generic content through knowledge graph flow");

			if (!serviceManager.llmService.isReady()) {
				logError(
					"❌ LLM service not ready, skipping knowledge graph processing",
				);
				return;
			}

			// Create knowledge graph flow
			const knowledgeGraph = flowsService.createGraph("knowledge", {
				llm: serviceManager.llmService,
				embedding: serviceManager.embeddingService,
				database: serviceManager.databaseService,
			});

			// Prepare input state for generic content
			const initialState: Partial<KnowledgeGraphState> = {
				content: data.textContent,
				title: data.title,
				url: data.sourceUrl || data.originalUrl || `content://${contentId}`,
				pageId: contentId,
				referenceTimestamp: new Date().toISOString(),
				metadata: data.sourceMetadata as unknown as Record<string, unknown>,
				currentMessage: `Title: ${data.title}\n\nContent:\n${data.textContent}`,
				previousMessages: undefined,
			};

			logInfo("🔧 Knowledge graph initial state prepared for generic content", {
				contentId,
				sourceType: data.sourceType,
				hasContentId: !!contentId,
			});

			if (!contentId) {
				throw new Error(
					"No content ID available for knowledge graph processing",
				);
			}

			// Execute the knowledge graph flow
			const result = await knowledgeGraph.invoke(initialState);

			const stats = {
				contentId,
				sourceType: data.sourceType,
				nodesCreated: Array.isArray(result.createdNodes)
					? result.createdNodes.length
					: 0,
				edgesCreated: Array.isArray(result.createdEdges)
					? result.createdEdges.length
					: 0,
				sourceId: (result.createdSource as any)?.id || "unknown",
				errors: Array.isArray(result.errors) ? result.errors.length : 0,
				entitiesExtracted: Array.isArray(result.extractedEntities)
					? result.extractedEntities.length
					: 0,
				factsExtracted: Array.isArray(result.extractedFacts)
					? result.extractedFacts.length
					: 0,
			};

			logInfo(
				"✅ Knowledge graph processing completed for generic content:",
				stats,
			);

			if (Array.isArray(result.errors) && result.errors.length > 0) {
				logError("⚠️ Knowledge graph processing had errors:", result.errors);
			}
		} catch (error) {
			logError(
				"❌ Failed to process generic content through knowledge graph:",
				error,
			);
			// Don't throw error - knowledge graph processing is optional
		}
	}
}

// Export singleton instance
export const rememberService = RememberService.getInstance();
