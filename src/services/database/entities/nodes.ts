import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	index,
	vector,
} from "drizzle-orm/pg-core";

export const nodes = pgTable(
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
	(table) => ({
		nodeTypeIdx: index("nodes_node_type_idx").on(table.nodeType),
		nameIdx: index("nodes_name_idx").on(table.name),
		groupIdIdx: index("nodes_group_id_idx").on(table.groupId),
		summaryIdx: index("nodes_summary_idx").on(table.summary),
	}),
);

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
