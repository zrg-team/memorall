import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	index,
	vector,
} from "drizzle-orm/pg-core";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "nodes";
export const node = pgTable(
	tableName,
	{
		id: uuid("id").primaryKey().defaultRandom(),
		nodeType: text("node_type").notNull(),
		name: text("name").notNull(),
		summary: text("summary"),
		attributes: jsonb("attributes").default({}),
		groupId: uuid("group_id"),
		nameEmbedding: vector("name_embedding", { dimensions: 768 }),
		graph: text("graph").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("nodes_node_type_idx").on(table.nodeType),
		index("nodes_name_idx").on(table.name),
		index("nodes_group_id_idx").on(table.groupId),
		index("nodes_summary_idx").on(table.summary),
		index("nodes_graph_idx").on(table.graph),
	],
);

export type Node = typeof node.$inferSelect;
export type NewNode = typeof node.$inferInsert;

// Manual indexes that can't be auto-generated
export const nodeManualIndexes = [
	// Full-text search indexes using GIN for trigram search (used by search_nodes_trigram function)
	`CREATE INDEX IF NOT EXISTS ${tableName}_name_trgm_idx ON ${tableName} USING GIN (name gin_trgm_ops);`,
	`CREATE INDEX IF NOT EXISTS ${tableName}_summary_trgm_idx ON ${tableName} USING GIN (summary gin_trgm_ops);`,
];

// Database trigger commands to automatically set timestamps
export const nodeTriggers = [defaultNowToTrigger(tableName)];
