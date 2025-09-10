import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	primaryKey,
	index,
} from "drizzle-orm/pg-core";
import { sources } from "./sources";
import { nodes } from "./nodes";

export const sourceNodes = pgTable(
	"source_nodes",
	{
		sourceId: uuid("source_id")
			.notNull()
			.references(() => sources.id),
		nodeId: uuid("node_id")
			.notNull()
			.references(() => nodes.id),
		relation: text("relation").notNull(),
		attributes: jsonb("attributes").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.sourceId, table.nodeId] }),
		sourceIdIdx: index("source_nodes_source_id_idx").on(table.sourceId),
		nodeIdIdx: index("source_nodes_node_id_idx").on(table.nodeId),
		relationIdx: index("source_nodes_relation_idx").on(table.relation),
	}),
);

export type SourceNode = typeof sourceNodes.$inferSelect;
export type NewSourceNode = typeof sourceNodes.$inferInsert;
