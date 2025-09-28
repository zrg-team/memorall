import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	index,
	vector,
} from "drizzle-orm/pg-core";

export const node = pgTable(
	"nodes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		nodeType: text("node_type").notNull(),
		name: text("name").notNull(),
		summary: text("summary"),
		attributes: jsonb("attributes").default({}),
		groupId: uuid("group_id"),
		nameEmbedding: vector("name_embedding", { dimensions: 768 }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("nodes_node_type_idx").on(table.nodeType),
		index("nodes_name_idx").on(table.name),
		index("nodes_group_id_idx").on(table.groupId),
		index("nodes_summary_idx").on(table.summary),
	],
);

export type Node = typeof node.$inferSelect;
export type NewNode = typeof node.$inferInsert;

// Manual indexes that can't be auto-generated
export const nodeManualIndexes = [
	// Full-text search indexes using GIN for trigram search (used by search_nodes_trigram function)
	"CREATE INDEX IF NOT EXISTS nodes_name_trgm_idx ON nodes USING GIN (name gin_trgm_ops);",
	"CREATE INDEX IF NOT EXISTS nodes_summary_trgm_idx ON nodes USING GIN (summary gin_trgm_ops);",
];
