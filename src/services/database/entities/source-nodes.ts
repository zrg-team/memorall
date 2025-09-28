import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	primaryKey,
	index,
} from "drizzle-orm/pg-core";
import { source } from "./sources";
import { node } from "./nodes";

export const sourceNode = pgTable(
	"source_nodes",
	{
		sourceId: uuid("source_id")
			.notNull()
			.references(() => source.id),
		nodeId: uuid("node_id")
			.notNull()
			.references(() => node.id),
		relation: text("relation").notNull(),
		attributes: jsonb("attributes").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ([
		primaryKey({ columns: [table.sourceId, table.nodeId] }),
		index("source_nodes_source_id_idx").on(table.sourceId),
		index("source_nodes_node_id_idx").on(table.nodeId),
		index("source_nodes_relation_idx").on(table.relation),
	]),
);

export type SourceNode = typeof sourceNode.$inferSelect;
export type NewSourceNode = typeof sourceNode.$inferInsert;
