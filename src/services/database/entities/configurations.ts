import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "configurations";
export const configuration = pgTable(tableName, {
	id: uuid("id").primaryKey().defaultRandom(),
	key: text("key").notNull().unique(),
	data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp("created_at").notNull(),
	updatedAt: timestamp("updated_at").notNull(),
});

export type Configuration = typeof configuration.$inferSelect;
export type NewConfiguration = typeof configuration.$inferInsert;

// Database trigger commands to automatically set timestamps
export const configurationTriggers = [defaultNowToTrigger(tableName)];
