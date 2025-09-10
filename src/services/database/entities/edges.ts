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
import { nodes } from "./nodes";

export const edges = pgTable(
	"edges",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		sourceId: uuid("source_id")
			.notNull()
			.references(() => nodes.id),
		destinationId: uuid("destination_id")
			.notNull()
			.references(() => nodes.id),
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
	(table) => ({
		sourceIdIdx: index("edges_source_id_idx").on(table.sourceId),
		destinationIdIdx: index("edges_destination_id_idx").on(table.destinationId),
		edgeTypeIdx: index("edges_edge_type_idx").on(table.edgeType),
		groupIdIdx: index("edges_group_id_idx").on(table.groupId),
		isCurrentIdx: index("edges_is_current_idx").on(table.isCurrent),
		validAtIdx: index("edges_valid_at_idx").on(table.validAt),
		recordedAtIdx: index("edges_recorded_at_idx").on(table.recordedAt),
	}),
);

export type Edge = typeof edges.$inferSelect;
export type NewEdge = typeof edges.$inferInsert;
