import { eq, like, desc } from "drizzle-orm";
import type { DatabaseService } from "@/services/database/database-service";
import type { Topic, NewTopic } from "@/services/database/entities/topics";
import { logInfo, logError } from "@/utils/logger";

export interface TopicSearchOptions {
	searchTerm?: string;
	limit?: number;
	offset?: number;
}

export class TopicService {
	constructor(private database: DatabaseService) {}

	/**
	 * Create a new topic
	 */
	async createTopic(
		topicData: Omit<NewTopic, "id" | "createdAt" | "updatedAt">,
	): Promise<Topic> {
		try {
			logInfo("[TOPIC_SERVICE] Creating new topic:", topicData);

			const result = await this.database.use(async ({ db, schema }) => {
				const [createdTopic] = await db
					.insert(schema.topics)
					.values({
						name: topicData.name,
						description: topicData.description || "",
					})
					.returning();

				return createdTopic;
			});

			logInfo("[TOPIC_SERVICE] Successfully created topic:", result);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to create topic:", error);
			throw error;
		}
	}

	/**
	 * Get all topics with optional search and pagination
	 */
	async getTopics(options: TopicSearchOptions = {}): Promise<Topic[]> {
		try {
			const { searchTerm, limit = 100, offset = 0 } = options;

			logInfo("[TOPIC_SERVICE] Fetching topics:", options);

			const result = await this.database.use(async ({ db, schema }) => {
				let query = db.select().from(schema.topics);

				// Add search filter if provided
				if (searchTerm && searchTerm.trim()) {
					const searchPattern = `%${searchTerm.trim()}%`;
					query = query.where(
						like(schema.topics.name, searchPattern),
					) as typeof query;
				}

				// Add ordering and pagination
				query = query
					.orderBy(desc(schema.topics.createdAt))
					.limit(limit)
					.offset(offset) as typeof query;

				return await query;
			});

			logInfo(`[TOPIC_SERVICE] Retrieved ${result.length} topics`);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topics:", error);
			throw error;
		}
	}

	/**
	 * Get a topic by ID
	 */
	async getTopicById(topicId: string): Promise<Topic | null> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching topic by ID:", topicId);

			const result = await this.database.use(async ({ db, schema }) => {
				const topics = await db
					.select()
					.from(schema.topics)
					.where(eq(schema.topics.id, topicId))
					.limit(1);

				return topics[0] || null;
			});

			logInfo("[TOPIC_SERVICE] Retrieved topic:", result);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topic by ID:", error);
			throw error;
		}
	}

	/**
	 * Update a topic
	 */
	async updateTopic(
		topicId: string,
		updates: Partial<Pick<NewTopic, "name" | "description">>,
	): Promise<Topic> {
		try {
			logInfo("[TOPIC_SERVICE] Updating topic:", { topicId, updates });

			const result = await this.database.use(async ({ db, schema }) => {
				const [updatedTopic] = await db
					.update(schema.topics)
					.set({
						...updates,
						updatedAt: new Date(),
					})
					.where(eq(schema.topics.id, topicId))
					.returning();

				if (!updatedTopic) {
					throw new Error(`Topic with ID ${topicId} not found`);
				}

				return updatedTopic;
			});

			logInfo("[TOPIC_SERVICE] Successfully updated topic:", result);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to update topic:", error);
			throw error;
		}
	}

	/**
	 * Delete a topic
	 */
	async deleteTopic(topicId: string): Promise<void> {
		try {
			logInfo("[TOPIC_SERVICE] Deleting topic:", topicId);

			await this.database.use(async ({ db, schema }) => {
				const deletedRows = await db
					.delete(schema.topics)
					.where(eq(schema.topics.id, topicId));

				logInfo("[TOPIC_SERVICE] Successfully deleted topic:", deletedRows);
			});
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to delete topic:", error);
			throw error;
		}
	}

	/**
	 * Get topics that contain specific content (by content count)
	 */
	async getTopicsWithContentCount(): Promise<Array<Topic>> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching topics with content count");

			const result = await this.database.use(async ({ db, schema }) => {
				const query = `
					SELECT
						t.*,
						COALESCE(content_counts.count, 0)::integer as content_count
					FROM topics t
					LEFT JOIN (
						SELECT
							topic_id,
							COUNT(*) as count
						FROM remembered_contents
						WHERE topic_id IS NOT NULL
						GROUP BY topic_id
					) content_counts ON t.id = content_counts.topic_id
					ORDER BY t.created_at DESC
				`;

				const rawResult = await db.query.topics.findMany();

				return rawResult.map((row) => ({
					...row,
				}));
			});

			logInfo(
				`[TOPIC_SERVICE] Retrieved ${result.length} topics with content count`,
			);
			return result;
		} catch (error) {
			logError(
				"[TOPIC_SERVICE] Failed to fetch topics with content count:",
				error,
			);
			throw error;
		}
	}
}

// Create a singleton instance that will be initialized by the service manager
let topicServiceInstance: TopicService | null = null;

export function createTopicService(database: DatabaseService): TopicService {
	if (!topicServiceInstance) {
		topicServiceInstance = new TopicService(database);
	}
	return topicServiceInstance;
}

export { topicServiceInstance as topicService };
