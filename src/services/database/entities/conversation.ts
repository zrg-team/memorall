import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title"),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
