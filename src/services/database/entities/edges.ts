import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	boolean,
	real,
	integer,
	index,
	vector,
} from "drizzle-orm/pg-core";
import { node } from "./nodes";

export const edge = pgTable(
	"edges",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: uuid("source_id")
			.notNull()
			.references(() => node.id),
		destinationId: uuid("destination_id")
			.notNull()
			.references(() => node.id),
		edgeType: text("edge_type").notNull(),
		factText: text("fact_text"),
		validAt: timestamp("valid_at"),
		invalidAt: timestamp("invalid_at"),
		recordedAt: timestamp("recorded_at").defaultNow().notNull(),
		attributes: jsonb("attributes").default({}),
		groupId: uuid("group_id"),
		isCurrent: boolean("is_current").default(true),
		provenanceWeightCache: real("provenance_weight_cache"),
		provenanceCountCache: integer("provenance_count_cache"),
		factEmbedding: vector("fact_embedding", { dimensions: 768 }),
		typeEmbedding: vector("type_embedding", { dimensions: 768 }),
		searchVector: text("search_vector"), // TSVECTOR as text (PGlite doesn't support tsvector)
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => ([
		index("edges_source_id_idx").on(table.sourceId),
		index("edges_destination_id_idx").on(table.destinationId),
		index("edges_edge_type_idx").on(table.edgeType),
		index("edges_group_id_idx").on(table.groupId),
		index("edges_is_current_idx").on(table.isCurrent),
		index("edges_valid_at_idx").on(table.validAt),
		index("edges_recorded_at_idx").on(table.recordedAt),
	]),
);

export type Edge = typeof edge.$inferSelect;
export type NewEdge = typeof edge.$inferInsert;

// Manual indexes that can't be auto-generated
export const edgeManualIndexes = [
  // Full-text search indexes using GIN for trigram search (used by search_edges_trigram function)
  "CREATE INDEX IF NOT EXISTS edges_fact_text_trgm_idx ON edges USING GIN (fact_text gin_trgm_ops);",
  "CREATE INDEX IF NOT EXISTS edges_edge_type_trgm_idx ON edges USING GIN (edge_type gin_trgm_ops);",
];
