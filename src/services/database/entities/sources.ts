import {
	pgTable,
	uuid,
	text,
	jsonb,
	timestamp,
	real,
	index,
	vector,
} from "drizzle-orm/pg-core";

export const sources = pgTable(
	"sources",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		type: text("type").notNull().default("page"),
		raw: text("raw").default(""),
		targetType: text("target_type").notNull(),
		targetId: text("target_id").notNull(),
		name: text("name").notNull(),
		metadata: jsonb("metadata").default({}),
		referenceTime: timestamp("reference_time"),
		groupId: uuid("group_id"),
		weight: real("weight").default(1.0),
		embedding: vector("embedding", { dimensions: 768 }),
		status: text("status").default("pending"), // Status: pending, processing, completed, failed
		statusValidFrom: timestamp("status_valid_from"), // When current status started (for timeout calculation)
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => ({
		targetTypeIdx: index("sources_target_type_idx").on(table.targetType),
		targetIdIdx: index("sources_target_id_idx").on(table.targetId),
		nameIdx: index("sources_name_idx").on(table.name),
		groupIdIdx: index("sources_group_id_idx").on(table.groupId),
		referenceTimeIdx: index("sources_reference_time_idx").on(
			table.referenceTime,
		),
		weightIdx: index("sources_weight_idx").on(table.weight),
		statusIdx: index("sources_status_idx").on(table.status),
	}),
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
