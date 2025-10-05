import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	real,
	index,
} from "drizzle-orm/pg-core";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "sources";
export const source = pgTable(
	tableName,
	{
		id: uuid("id").primaryKey().defaultRandom(),
		type: text("type").notNull().default("page"),
		raw: text("raw").default(""),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		name: text("name").notNull(),
		metadata: jsonb("metadata").default({}),
		referenceTime: timestamp("reference_time"),
		weight: real("weight").default(1.0),
		status: text("status").default("pending"), // Status: pending, processing, completed, failed
		statusValidFrom: timestamp("status_valid_from"), // When current status started (for timeout calculation)
		graph: text("graph").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("sources_target_type_idx").on(table.targetType),
		index("sources_target_id_idx").on(table.targetId),
		index("sources_name_idx").on(table.name),
		index("sources_reference_time_idx").on(table.referenceTime),
		index("sources_weight_idx").on(table.weight),
		index("sources_status_idx").on(table.status),
		index("sources_graph_idx").on(table.graph),
	],
);

export type Source = typeof source.$inferSelect;
export type NewSource = typeof source.$inferInsert;

/**
 * Helper function to get the effective status of a source, accounting for timeout
 * @param source The source object
 * @param timeoutMinutes Timeout in minutes (default 30)
 * @returns The effective status (may convert "processing" to "failed" if timed out)
 */
export function getEffectiveSourceStatus(
	source: Source,
	timeoutMinutes: number = 30,
): string {
	if (source.status === "processing" && source.statusValidFrom) {
		const now = new Date();
		const timeoutAgo = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
		if (source.statusValidFrom < timeoutAgo) {
			return "failed";
		}
	}
	return source.status || "pending";
}

// Database trigger commands to automatically set timestamps
export const sourceTriggers = [defaultNowToTrigger(tableName)];
