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
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "source_nodes";
export const sourceNode = pgTable(
	tableName,
	{
		sourceId: uuid("source_id")
			.notNull()
			.references(() => source.id),
		nodeId: uuid("node_id")
			.notNull()
			.references(() => node.id),
		relation: text("relation").notNull(),
		attributes: jsonb("attributes").default({}),
		graph: text("graph").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.nodeId] }),
		index("source_nodes_source_id_idx").on(table.sourceId),
		index("source_nodes_node_id_idx").on(table.nodeId),
		index("source_nodes_relation_idx").on(table.relation),
		index("source_nodes_graph_idx").on(table.graph),
	],
);

export type SourceNode = typeof sourceNode.$inferSelect;
export type NewSourceNode = typeof sourceNode.$inferInsert;

// Database trigger commands to automatically set timestamps
export const sourceNodeTriggers = [
	defaultNowToTrigger(tableName, {
		createdAt: true,
	}),
];
