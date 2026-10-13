import { eq, like, desc, sql } from "drizzle-orm";
import type { Topic, NewTopic } from "@/services/database/types";
import {
	DEFAULT_GROW_TYPE,
	DEFAULT_RECALL_TYPE,
	getValidRecallTypes,
	isRecallTypeValidForGrow,
} from "@/services/database/entities/topic-types";
import { logInfo, logError } from "@/utils/logger";
import { serviceManager } from "@/services";

export interface TopicSearchOptions {
	searchTerm?: string;
	limit?: number;
	offset?: number;
}

export class TopicService {
	/**
	 * Create a new topic
	 */
	async createTopic(
		topicData: Omit<NewTopic, "id" | "createdAt" | "updatedAt">,
	): Promise<Topic> {
		try {
			logInfo("[TOPIC_SERVICE] Creating new topic:", topicData);

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const [createdTopic] = await db
						.insert(schema.topics)
						.values({
							name: topicData.name,
							description: topicData.description || "",
							agentId: topicData.agentId,
							growType: topicData.growType ?? DEFAULT_GROW_TYPE,
							recallType: isRecallTypeValidForGrow(
								topicData.growType ?? DEFAULT_GROW_TYPE,
								topicData.recallType ?? DEFAULT_RECALL_TYPE,
							)
								? (topicData.recallType ?? DEFAULT_RECALL_TYPE)
								: getValidRecallTypes(
										topicData.growType ?? DEFAULT_GROW_TYPE,
									)[0],
						})
						.returning();

					return createdTopic;
				},
			);

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

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
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
				},
			);

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

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const topics = await db
						.select()
						.from(schema.topics)
						.where(eq(schema.topics.id, topicId))
						.limit(1);

					return topics[0] || null;
				},
			);

			logInfo("[TOPIC_SERVICE] Retrieved topic:", result);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topic by ID:", error);
			throw error;
		}
	}

	/**
	 * Get the memory topic associated with an agent flow.
	 */
	async getTopicByAgentId(agentId: string): Promise<Topic | null> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching topic by agent ID:", agentId);

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const topics = await db
						.select()
						.from(schema.topics)
						.where(eq(schema.topics.agentId, agentId))
						.limit(1);

					return topics[0] || null;
				},
			);

			logInfo("[TOPIC_SERVICE] Retrieved agent topic:", result);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topic by agent ID:", error);
			throw error;
		}
	}

	/**
	 * Update a topic
	 */
	async updateTopic(
		topicId: string,
		updates: Partial<Pick<NewTopic, "name" | "description" | "recallType">>,
	): Promise<Topic> {
		try {
			logInfo("[TOPIC_SERVICE] Updating topic:", { topicId, updates });

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
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
				},
			);

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

			await serviceManager.databaseService.use(async ({ db, schema }) => {
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
	 * Get topics with file count
	 */
	async getTopicsWithContentCount(): Promise<
		Array<Topic & { fileCount: number }>
	> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching topics with file count");

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Two queries whatever the number of topics, counted by the
					// database rather than by fetching every topic's file rows.
					const [topics, counts] = await Promise.all([
						db
							.select()
							.from(schema.topics)
							.orderBy(desc(schema.topics.createdAt)),
						db
							.select({
								topicId: schema.topicFiles.topicId,
								fileCount: sql<number>`count(*)::int`,
							})
							.from(schema.topicFiles)
							.groupBy(schema.topicFiles.topicId),
					]);
					const fileCounts = new Map(
						counts.map((row) => [row.topicId, Number(row.fileCount)]),
					);

					return topics.map((topic) => ({
						...topic,
						fileCount: fileCounts.get(topic.id) ?? 0,
					}));
				},
			);

			logInfo(`[TOPIC_SERVICE] Retrieved ${result.length} topics`);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topics:", error);
			throw error;
		}
	}

	/**
	 * Get file paths for a specific topic
	 */
	async getTopicFiles(topicId: string): Promise<string[]> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching files for topic:", topicId);

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const topicFiles = await db
						.select()
						.from(schema.topicFiles)
						.where(eq(schema.topicFiles.topicId, topicId))
						.orderBy(desc(schema.topicFiles.createdAt));

					return topicFiles.map((tf) => tf.filePath);
				},
			);

			logInfo(`[TOPIC_SERVICE] Retrieved ${result.length} files for topic`);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch topic files:", error);
			throw error;
		}
	}

	/**
	 * Get topics for a specific file path
	 */
	async getFileTopics(filePath: string): Promise<Topic[]> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching topics for file:", filePath);

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const topicFiles = await db
						.select()
						.from(schema.topicFiles)
						.where(eq(schema.topicFiles.filePath, filePath));

					const topicIds = topicFiles.map((tf) => tf.topicId);

					if (topicIds.length === 0) {
						return [];
					}

					const topics = await db.select().from(schema.topics).where(
						eq(
							schema.topics.id,
							topicIds[0], // Start with first ID
						),
					);

					// Filter to match all topic IDs
					const filteredTopics = topics.filter((topic) =>
						topicIds.includes(topic.id),
					);

					// Get all topics that match
					const allTopics: Topic[] = [];
					for (const topicId of topicIds) {
						const topicResult = await db
							.select()
							.from(schema.topics)
							.where(eq(schema.topics.id, topicId))
							.limit(1);

						if (topicResult[0]) {
							allTopics.push(topicResult[0]);
						}
					}

					return allTopics;
				},
			);

			logInfo(`[TOPIC_SERVICE] Retrieved ${result.length} topics for file`);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch file topics:", error);
			throw error;
		}
	}

	/**
	 * Add a file to a topic
	 */
	async addFileToTopic(topicId: string, filePath: string): Promise<void> {
		try {
			logInfo("[TOPIC_SERVICE] Adding file to topic:", { topicId, filePath });

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Check if association already exists
				const existing = await db
					.select()
					.from(schema.topicFiles)
					.where(
						eq(schema.topicFiles.topicId, topicId) &&
							eq(schema.topicFiles.filePath, filePath),
					)
					.limit(1);

				if (existing.length === 0) {
					await db.insert(schema.topicFiles).values({
						topicId,
						filePath,
					});
				}
			});

			logInfo("[TOPIC_SERVICE] Successfully added file to topic");
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to add file to topic:", error);
			throw error;
		}
	}

	/**
	 * Remove a file from a topic
	 */
	async removeFileFromTopic(topicId: string, filePath: string): Promise<void> {
		try {
			logInfo("[TOPIC_SERVICE] Removing file from topic:", {
				topicId,
				filePath,
			});

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				await db
					.delete(schema.topicFiles)
					.where(
						eq(schema.topicFiles.topicId, topicId) &&
							eq(schema.topicFiles.filePath, filePath),
					);
			});

			logInfo("[TOPIC_SERVICE] Successfully removed file from topic");
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to remove file from topic:", error);
			throw error;
		}
	}

	/**
	 * Set topics for a file (replaces all existing associations)
	 */
	async setFileTopics(filePath: string, topicIds: string[]): Promise<void> {
		try {
			logInfo("[TOPIC_SERVICE] Setting topics for file:", {
				filePath,
				topicIds,
			});

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Remove all existing associations
				await db
					.delete(schema.topicFiles)
					.where(eq(schema.topicFiles.filePath, filePath));

				// Add new associations
				if (topicIds.length > 0) {
					await db.insert(schema.topicFiles).values(
						topicIds.map((topicId) => ({
							topicId,
							filePath,
						})),
					);
				}
			});

			logInfo("[TOPIC_SERVICE] Successfully set topics for file");
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to set file topics:", error);
			throw error;
		}
	}

	/**
	 * Get all file-topic associations as a map
	 */
	async getFileTopicMap(): Promise<Map<string, Topic[]>> {
		try {
			logInfo("[TOPIC_SERVICE] Fetching file-topic map");

			const result = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					// Only the two columns the map is built from.
					const [topicFiles, topics] = await Promise.all([
						db
							.select({
								topicId: schema.topicFiles.topicId,
								filePath: schema.topicFiles.filePath,
							})
							.from(schema.topicFiles),
						db.select().from(schema.topics),
					]);
					const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

					// Build map
					const map = new Map<string, Topic[]>();

					for (const tf of topicFiles) {
						const topic = topicsById.get(tf.topicId);
						if (topic) {
							const existing = map.get(tf.filePath) || [];
							existing.push(topic);
							map.set(tf.filePath, existing);
						}
					}

					return map;
				},
			);

			logInfo(
				`[TOPIC_SERVICE] Retrieved file-topic map with ${result.size} files`,
			);
			return result;
		} catch (error) {
			logError("[TOPIC_SERVICE] Failed to fetch file-topic map:", error);
			throw error;
		}
	}
}

const topicServiceInstance = new TopicService();

export { topicServiceInstance as topicService };
