import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	vector,
	boolean,
	index,
} from "drizzle-orm/pg-core";
import { topic } from "./topics";

export const rememberedContent = pgTable(
	"remembered_contents",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Content source information
		sourceType: text("source_type").notNull().default("webpage"), // webpage, selection, user_input, raw_text, etc.
		sourceUrl: text("source_url"), // URL for web pages, null for user input
		originalUrl: text("original_url"), // Original page URL when content is a selection

		// Core content fields
		title: text("title").notNull(),
		content: text("content").notNull(),

		// Flexible metadata storage for different source types
		sourceMetadata: jsonb("source_metadata").notNull().default("{}"), // Source-specific metadata
		extractionMetadata: jsonb("extraction_metadata").notNull().default("{}"), // Extraction/processing metadata

		// Embedding vector for semantic search
		embedding: vector("embedding", { dimensions: 768 }),

		// Tags for categorization
		tags: jsonb("tags").default("[]"),

		// Status flags
		isArchived: boolean("is_archived").default(false),
		isFavorite: boolean("is_favorite").default(false),

		metadata: jsonb("metadata").default({}),

		topicId: uuid("topic_id").references(() => topic.id),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		// Indexes for efficient queries
		index("remembered_content_source_type_idx").on(table.sourceType),
		index("remembered_content_source_url_idx").on(table.sourceUrl),
		index("remembered_content_title_idx").on(table.title),
		index("remembered_content_created_at_idx").on(table.createdAt),
		index("remembered_content_updated_at_idx").on(table.updatedAt),
		index("remembered_content_is_archived_idx").on(table.isArchived),
		index("remembered_content_is_favorite_idx").on(table.isFavorite),
		index("remembered_content_topic_idx").on(table.topicId),
		// Composite indexes for common queries
		index("remembered_content_source_type_created_idx").on(
			table.sourceType,
			table.createdAt,
		),
		index("remembered_content_status_created_idx").on(
			table.isArchived,
			table.createdAt,
		),
		index("remembered_content_favorite_created_idx").on(
			table.isFavorite,
			table.createdAt,
		),
	],
);

// TypeScript types
export type RememberedContent = typeof rememberedContent.$inferSelect;
export type NewRememberedContent = typeof rememberedContent.$inferInsert;

// Types are already exported above via the type declarations
