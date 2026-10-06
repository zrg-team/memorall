import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { conversation } from "./conversations";
import { flows } from "./flows";

const tableName = "model_usage";

/**
 * One model request made outside a chat reply (a chat reply keeps its own
 * usage in its message metadata). The Usage page adds both up.
 */
export const modelUsage = pgTable(
	tableName,
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** What made the request, e.g. "pi-code" or "studio". */
		source: text("source").notNull(),
		/** The tool the request is charged to on the Usage page, if any. */
		tool: text("tool"),
		agentFlowId: uuid("agent_flow_id").references(() => flows.id, {
			onDelete: "set null",
		}),
		/** The chat the request was made for (pi code on its agent's work); its cost counts it. */
		conversationId: uuid("conversation_id").references(() => conversation.id, {
			onDelete: "set null",
		}),
		/** Requests of one session (a pi session, a Studio session) group together. */
		sessionId: text("session_id").notNull(),
		title: text("title").notNull().default(""),
		provider: text("provider").notNull().default(""),
		model: text("model").notNull().default(""),
		/** Token usage in the shape chat replies store (`TokenUsage`). */
		usage: jsonb("usage").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("model_usage_created_at_idx").on(table.createdAt),
		index("model_usage_conversation_idx").on(table.conversationId),
	],
);

export type ModelUsageRow = typeof modelUsage.$inferSelect;
export type NewModelUsageRow = typeof modelUsage.$inferInsert;
