import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const conversation = pgTable("conversations", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title"),
	metadata: jsonb("metadata").default({}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
