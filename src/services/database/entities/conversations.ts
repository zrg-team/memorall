import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

const tableName = "conversations";
export const conversation = pgTable(tableName, {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title"),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
