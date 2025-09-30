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
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "edges";
export const edge = pgTable(
	tableName,
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
		attributes: jsonb("attributes").default({}),
		isCurrent: boolean("is_current").default(true),
		provenanceWeightCache: real("provenance_weight_cache"),
		provenanceCountCache: integer("provenance_count_cache"),
		factEmbedding: vector("fact_embedding", { dimensions: 768 }),
		typeEmbedding: vector("type_embedding", { dimensions: 768 }),
		graph: text("graph").notNull().default(""),
		recordedAt: timestamp("recorded_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("edges_source_id_idx").on(table.sourceId),
		index("edges_destination_id_idx").on(table.destinationId),
		index("edges_edge_type_idx").on(table.edgeType),
		index("edges_is_current_idx").on(table.isCurrent),
		index("edges_valid_at_idx").on(table.validAt),
		index("edges_recorded_at_idx").on(table.recordedAt),
		index("edges_graph_idx").on(table.graph),
	],
);

export type Edge = typeof edge.$inferSelect;
export type NewEdge = typeof edge.$inferInsert;

// Manual indexes that can't be auto-generated
export const edgeManualIndexes = [
	// Full-text search indexes using GIN for trigram search (used by search_edges_trigram function)
	`CREATE INDEX IF NOT EXISTS ${tableName}_fact_text_trgm_idx ON ${tableName} USING GIN (fact_text gin_trgm_ops);`,
	`CREATE INDEX IF NOT EXISTS ${tableName}_edge_type_trgm_idx ON ${tableName} USING GIN (edge_type gin_trgm_ops);`,
];

// Database trigger commands to automatically set timestamps
export const edgeTriggers = [defaultNowToTrigger(tableName)];
