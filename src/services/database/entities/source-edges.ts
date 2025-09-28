import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	real,
	primaryKey,
	index,
} from "drizzle-orm/pg-core";
import { source } from "./sources";
import { edge } from "./edges";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "source_edges";
export const sourceEdge = pgTable(
	tableName,
	{
		sourceId: uuid("source_id")
			.notNull()
			.references(() => source.id),
		edgeId: uuid("edge_id")
			.notNull()
			.references(() => edge.id),
		relation: text("relation").notNull(),
		linkWeight: real("link_weight").default(1.0),
		attributes: jsonb("attributes").default({}),
		graph: text("graph").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.sourceId, table.edgeId] }),
		index("source_edges_source_id_idx").on(table.sourceId),
		index("source_edges_edge_id_idx").on(table.edgeId),
		index("source_edges_relation_idx").on(table.relation),
		index("source_edges_link_weight_idx").on(table.linkWeight),
		index("source_edges_graph_idx").on(table.graph),
	],
);

export type SourceEdge = typeof sourceEdge.$inferSelect;
export type NewSourceEdge = typeof sourceEdge.$inferInsert;

// Database trigger commands to automatically set timestamps
export const sourceEdgeTriggers = [
	defaultNowToTrigger(tableName, {
		createdAt: true,
	}),
];
