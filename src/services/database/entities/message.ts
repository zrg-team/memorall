import {
	text,
	integer,
	timestamp,
	jsonb,
	index,
	uuid,
	vector,
	pgTable,
	varchar,
} from "drizzle-orm/pg-core";
import { conversations } from "./conversation";

export const messages = pgTable(
	"messages",
	{
		id: uuid("uuid").primaryKey().defaultRandom(),
		conversationId: uuid("conversation_id")
			.references(() => conversations.id)
			.notNull(),
		type: varchar("type", { length: 50 }).notNull().default("text"), // 'text', 'image', 'separator', etc.
		role: text("role").notNull(), // 'user', 'assistant', 'system'
		content: text("content").notNull(),
		complexContent: jsonb("complex_content"), // For storing structured content like images, files, etc.
		embedding: vector("embedding", { dimensions: 768 }),
		metadata: jsonb("metadata").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => ({
		conversationIdx: index("messages_conversation_idx").on(
			table.conversationId,
		),
		roleIdx: index("messages_role_idx").on(table.role),
	}),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
