import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const encryption = pgTable("encryptions", {
	id: uuid("id").primaryKey().defaultRandom(),
	key: text("key").notNull().unique(), // unique key like "openai_config"
	advancedSeed: text("advanced_seed"), // advanced key for AES encryption
	encryptedData: text("encrypted_data").notNull(), // RSA encrypted data
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Encryption = typeof encryption.$inferSelect;
export type NewEncryption = typeof encryption.$inferInsert;
