import { text, timestamp, uuid, pgTable } from "drizzle-orm/pg-core";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";

const tableName = "topics";
export const topic = pgTable(tableName, {
	id: uuid("uuid").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	description: text("description").default(""),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Topic = typeof topic.$inferSelect;
export type NewTopic = typeof topic.$inferInsert;

// Database trigger commands to automatically set timestamps
export const topicTriggers = [defaultNowToTrigger(tableName)];
