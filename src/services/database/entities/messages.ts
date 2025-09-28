import {
	text,
	timestamp,
	jsonb,
	index,
	uuid,
	vector,
	pgTable,
	varchar,
} from "drizzle-orm/pg-core";
import { conversation } from "./conversations";
import { topic } from "./topics";

const tableName = "messages";
export const message = pgTable(
	tableName,
	{
		id: uuid("uuid").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.references(() => conversation.id)
			.notNull(),
		type: varchar("type", { length: 50 }).notNull().default("text"), // 'text', 'image', 'separator', etc.
		role: text("role").notNull(), // 'user', 'assistant', 'system'
		content: text("content").notNull(),
		complexContent: jsonb("complex_content"), // For storing structured content like images, files, etc.
		topicId: uuid("topic_id").references(() => topic.id),
		embedding: vector("embedding", { dimensions: 768 }),
		metadata: jsonb("metadata").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("messages_conversation_idx").on(table.conversationId),
		index("messages_role_idx").on(table.role),
		index("messages_topic_idx").on(table.topicId),
	],
);

export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
