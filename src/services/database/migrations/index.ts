import type { PGlite } from "@electric-sql/pglite";
import { logDebug, logError } from "@/utils/logger";
import { up as initialMigration } from "./000_initial";
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
	return result.rows.map((row) => typeof row === 'object' && row && 'id' in row ? `${row.id}` : '');
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
