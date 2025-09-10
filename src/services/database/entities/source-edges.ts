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
import { sources } from "./sources";
import { edges } from "./edges";

export const sourceEdges = pgTable(
	"source_edges",
	{
		sourceId: uuid("source_id")
			.notNull()
			.references(() => sources.id),
		edgeId: uuid("edge_id")
			.notNull()
			.references(() => edges.id),
		relation: text("relation").notNull(),
		linkWeight: real("link_weight").default(1.0),
		attributes: jsonb("attributes").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.sourceId, table.edgeId] }),
		sourceIdIdx: index("source_edges_source_id_idx").on(table.sourceId),
		edgeIdIdx: index("source_edges_edge_id_idx").on(table.edgeId),
		relationIdx: index("source_edges_relation_idx").on(table.relation),
		linkWeightIdx: index("source_edges_link_weight_idx").on(table.linkWeight),
	}),
);

export type SourceEdge = typeof sourceEdges.$inferSelect;
export type NewSourceEdge = typeof sourceEdges.$inferInsert;
