import {
	pgTable,
	text,
	timestamp,
	jsonb,
	uuid,
	index,
	varchar,
} from "drizzle-orm/pg-core";
import { defaultNowToTrigger } from "../utils/default-now-to-trigger";
import { flows } from "./flows";

const tableName = "conversations";
export const conversation = pgTable(
	tableName,
	{
		id: uuid("id").primaryKey().defaultRandom(),
		title: text("title"),
		name: text("name"),
		agentFlowId: uuid("agent_flow_id").references(() => flows.id, {
			onDelete: "set null",
		}),
		/** Workspace the conversation belongs to: "chat" or a media studio. */
		mode: varchar("mode", { length: 32 }).notNull().default("chat"),
		metadata: jsonb("metadata").default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("conversations_agent_flow_id_idx").on(table.agentFlowId),
		index("conversations_mode_updated_idx").on(table.mode, table.updatedAt),
	],
);

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;

// Database trigger commands to automatically set timestamps
export const conversationTriggers = [defaultNowToTrigger(tableName)];
