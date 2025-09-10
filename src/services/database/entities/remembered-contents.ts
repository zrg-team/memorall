import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	vector,
	real,
	boolean,
	index,
} from "drizzle-orm/pg-core";

export const rememberedContent = pgTable(
	"remembered_content",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Content source information
		sourceType: text("source_type").notNull().default("webpage"), // webpage, selection, user_input, raw_text, etc.
		sourceUrl: text("source_url"), // URL for web pages, null for user input
		originalUrl: text("original_url"), // Original page URL when content is a selection

		// Core content fields
		title: text("title").notNull(),
		rawContent: text("raw_content").notNull(), // Original HTML/text content
		cleanContent: text("clean_content").notNull(), // Cleaned/processed content
		textContent: text("text_content").notNull(), // Plain text version

		// Flexible metadata storage for different source types
		sourceMetadata: jsonb("source_metadata").notNull().default("{}"), // Source-specific metadata
		extractionMetadata: jsonb("extraction_metadata").notNull().default("{}"), // Extraction/processing metadata

		// Embedding vector for semantic search
		embedding: vector("embedding", { dimensions: 768 }),

		// Full-text search vector
		searchVector: text("search_vector"),

		// Tags for categorization
		tags: jsonb("tags").default("[]"),

		// User notes
		notes: text("notes"),

		// Content quality metrics
		contentLength: real("content_length").default(0),
		readabilityScore: real("readability_score"),

		// Status flags
		isArchived: boolean("is_archived").default(false),
		isFavorite: boolean("is_favorite").default(false),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => ({
		// Indexes for efficient queries
		sourceTypeIdx: index("remembered_content_source_type_idx").on(
			table.sourceType,
		),
		sourceUrlIdx: index("remembered_content_source_url_idx").on(
			table.sourceUrl,
		),
		titleIdx: index("remembered_content_title_idx").on(table.title),
		createdAtIdx: index("remembered_content_created_at_idx").on(
			table.createdAt,
		),
		updatedAtIdx: index("remembered_content_updated_at_idx").on(
			table.updatedAt,
		),
		isArchivedIdx: index("remembered_content_is_archived_idx").on(
			table.isArchived,
		),
		isFavoriteIdx: index("remembered_content_is_favorite_idx").on(
			table.isFavorite,
		),
		contentLengthIdx: index("remembered_content_content_length_idx").on(
			table.contentLength,
		),

		// Composite indexes for common queries
		sourceTypeCreatedIdx: index(
			"remembered_content_source_type_created_idx",
		).on(table.sourceType, table.createdAt),
		statusCreatedIdx: index("remembered_content_status_created_idx").on(
			table.isArchived,
			table.createdAt,
		),
		favoriteCreatedIdx: index("remembered_content_favorite_created_idx").on(
			table.isFavorite,
			table.createdAt,
		),
	}),
);

// TypeScript types
export type RememberedContent = typeof rememberedContent.$inferSelect;
export type NewRememberedContent = typeof rememberedContent.$inferInsert;

// Types are already exported above via the type declarations
