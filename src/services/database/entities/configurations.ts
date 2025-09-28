import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const configuration = pgTable("configurations", {
	id: uuid("id").primaryKey().defaultRandom(),
	key: text("key").notNull().unique(),
	data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Configuration = typeof configuration.$inferSelect;
export type NewConfiguration = typeof configuration.$inferInsert;
