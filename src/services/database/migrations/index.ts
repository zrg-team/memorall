import type { PGlite } from "@electric-sql/pglite";
import { logDebug, logError } from "@/utils/logger";
import { up as initialMigration } from "./000_initial";
import {
	up as addTopicFilesUp,
	down as addTopicFilesDown,
} from "./002_add_topic_files";
import {
	up as addActivityTrackingUp,
	down as addActivityTrackingDown,
} from "./003_add_activity_tracking";
import {
	up as addDisplayMetaUp,
	down as addDisplayMetaDown,
} from "./004_add_display_meta";
import {
	up as addMultiSizeEmbeddingsUp,
	down as addMultiSizeEmbeddingsDown,
} from "./005_add_multi_size_embeddings";
import {
	up as addFlowBuilderUp,
	down as addFlowBuilderDown,
} from "./006_add_flow_builder";
import {
	up as addPredefinedFlowUp,
	down as addPredefinedFlowDown,
} from "./007_add_predefined_flow_and_flow_configs";
import {
	up as addMessageQueryIndexesUp,
	down as addMessageQueryIndexesDown,
} from "./008_add_message_query_indexes";
import {
	up as addAgentIdToTopicsUp,
	down as addAgentIdToTopicsDown,
} from "./009_add_agent_id_to_topics";
import {
	up as addGrowRecallTypeUp,
	down as addGrowRecallTypeDown,
} from "./010_add_grow_recall_type_to_topics";
import {
	up as addCronJobsUp,
	down as addCronJobsDown,
} from "./011_add_cron_jobs";
import {
	up as renameKnowledgeRagToFoundationUp,
	down as renameKnowledgeRagToFoundationDown,
} from "./012_rename_knowledge_rag_to_foundation";
import {
	up as addMessagePartsUp,
	down as addMessagePartsDown,
} from "./013_add_message_parts";
import {
	up as addMessageHistorySearchIndexUp,
	down as addMessageHistorySearchIndexDown,
} from "./014_add_message_history_search_index";
// import { up as futureExampleUp, down as futureExampleDown } from './001_example_future_migration';

export interface Migration {
	id: string;
	version: number;
	description: string;
	up: (db: PGlite) => Promise<void>;
	down?: (db: PGlite) => Promise<void>;
}

// Define all migrations in order
export const migrations: Migration[] = [
	{
		id: "initial",
		version: 1,
		description:
			"Initial schema with knowledge graph, conversations, and trigram search",
		up: initialMigration,
	},
	{
		id: "add_topic_files",
		version: 2,
		description: "Add topic_files table for linking files to topics",
		up: addTopicFilesUp,
		down: addTopicFilesDown,
	},
	{
		id: "add_activity_tracking",
		version: 3,
		description:
			"Add activity_sessions and activities tables for activity tracking",
		up: addActivityTrackingUp,
		down: addActivityTrackingDown,
	},
	{
		id: "add_display_meta",
		version: 4,
		description:
			"Add display_meta column to activities table for user-friendly rendering",
		up: addDisplayMetaUp,
		down: addDisplayMetaDown,
	},
	{
		id: "add_multi_size_embeddings",
		version: 5,
		description:
			"Add multi-size embedding support (small 384d, medium 768d, large 1536d)",
		up: addMultiSizeEmbeddingsUp,
		down: addMultiSizeEmbeddingsDown,
	},
	{
		id: "add_flow_builder",
		version: 6,
		description:
			"Add flow builder tables (flows, flow_states, flow_services, flow_steps, flow_connections)",
		up: addFlowBuilderUp,
		down: addFlowBuilderDown,
	},
	{
		id: "add_predefined_flow_and_flow_configs",
		version: 7,
		description: "Add predefined_flow column to flows and flow_configs table",
		up: addPredefinedFlowUp,
		down: addPredefinedFlowDown,
	},
	{
		id: "add_message_query_indexes",
		version: 8,
		description:
			"Add conversation/time indexes for separator-first message loading",
		up: addMessageQueryIndexesUp,
		down: addMessageQueryIndexesDown,
	},
	{
		id: "add_agent_id_to_topics",
		version: 9,
		description:
			"Add agent_id to topics for linking memory zones to agents (nullable — independent topics remain unlinked)",
		up: addAgentIdToTopicsUp,
		down: addAgentIdToTopicsDown,
	},
	{
		id: "add_grow_recall_type_to_topics",
		version: 10,
		description:
			"Add grow_type and recall_type to topics — grow_type is immutable (knowledge-graph|structmem), recall_type is mutable per-memory retrieval strategy",
		up: addGrowRecallTypeUp,
		down: addGrowRecallTypeDown,
	},
	{
		id: "add_cron_jobs",
		version: 11,
		description: "Add durable agent cron jobs and link conversations to agents",
		up: addCronJobsUp,
		down: addCronJobsDown,
	},
	{
		id: "rename_knowledge_rag_to_foundation",
		version: 12,
		description: "Rename predefined knowledge RAG flow records to foundation",
		up: renameKnowledgeRagToFoundationUp,
		down: renameKnowledgeRagToFoundationDown,
	},
	{
		id: "add_message_parts",
		version: 13,
		description:
			"Add message parts column for canonical role-based message records",
		up: addMessagePartsUp,
		down: addMessagePartsDown,
	},
	{
		id: "add_message_history_search_index",
		version: 14,
		description: "Add full-text index for separator-scoped thread history search",
		up: addMessageHistorySearchIndexUp,
		down: addMessageHistorySearchIndexDown,
	},
	// Example of how to add future migrations:
	// {
	//   id: '002_example_future_migration',
	//   version: 2,
	//   description: 'Example future migration',
	//   up: futureExampleUp,
	//   down: futureExampleDown,
	// },
];

// Create migrations lookup by ID
export const migrationsById = migrations.reduce(
	(acc, migration) => {
		acc[migration.id] = migration;
		return acc;
	},
	{} as Record<string, Migration>,
);

// Migration tracking functions
export async function createMigrationTable(db: PGlite): Promise<void> {
	await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      description TEXT NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
}

export async function getAppliedMigrations(db: PGlite): Promise<string[]> {
	const result = await db.query(`
    SELECT id FROM _migrations
    ORDER BY version ASC
  `);
	return result.rows.map((row) =>
		typeof row === "object" && row && "id" in row ? `${row.id}` : "",
	);
}

export async function markMigrationApplied(
	db: PGlite,
	migration: Migration,
): Promise<void> {
	await db.query(
		`
    INSERT INTO _migrations (id, version, description)
    VALUES ($1, $2, $3)
    ON CONFLICT (id) DO NOTHING
  `,
		[migration.id, migration.version, migration.description],
	);
}

export async function runMigrations(db: PGlite): Promise<void> {
	// First, ensure migration tracking table exists
	await createMigrationTable(db);

	// Get list of applied migrations
	const appliedMigrations = await getAppliedMigrations(db);

	// Run pending migrations in order
	for (const migration of migrations) {
		if (!appliedMigrations.includes(migration.id)) {
			logDebug(`Running migration: ${migration.id} - ${migration.description}`);

			try {
				await migration.up(db);
				await markMigrationApplied(db, migration);
				logDebug(`✅ Migration ${migration.id} completed successfully`);
			} catch (error) {
				logError(`❌ Migration ${migration.id} failed:`, error);
				throw error;
			}
		} else {
			logDebug(`⏭️ Migration ${migration.id} already applied`);
		}
	}
}
