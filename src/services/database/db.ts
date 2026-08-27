// Standalone database service - Simple and Direct
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { logError, logInfo } from "@/utils/logger";

import { idbFastSyncExtension } from "./idb-fast-sync";
import { runMigrations } from "./migrations";
import { DatabaseMode, type DatabaseConfig } from "./constants";
import { schema } from "./schema";

// Database instances - support both main and proxy modes
let pgliteInstance: PGlite | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let currentMode: DatabaseMode | null = null;

// Initialize database with mode support
export async function initDB(
	config?: DatabaseConfig,
): Promise<ReturnType<typeof drizzle<typeof schema>>>;
export async function initDB(
	dataDir?: string,
): Promise<ReturnType<typeof drizzle<typeof schema>>>;
export async function initDB(configOrDataDir?: DatabaseConfig | string) {
	if (db) return db;

	try {
		// Handle backward compatibility - if string is passed, treat as dataDir in main mode
		const config: DatabaseConfig =
			typeof configOrDataDir === "string"
				? { mode: DatabaseMode.MAIN, dataDir: configOrDataDir }
				: configOrDataDir || { mode: DatabaseMode.MAIN };

		currentMode = config.mode;

		if (config.mode === DatabaseMode.MAIN) {
			// Main mode: Create real PGlite instance
			const realPglite = new PGlite(config.dataDir || "idb://memorall-db", {
				extensions: {
					vector,
					uuid_ossp,
					pg_trgm,
					// Keeps IndexedDB persistence O(changed files) instead of
					// O(every file) per statement. Safari/Firefox are unusable
					// without it; see ./idb-fast-sync.ts.
					idbFastSync: idbFastSyncExtension,
				},
			});
			await realPglite.waitReady;
			pgliteInstance = realPglite;

			// Run database migrations in main mode only
			await runMigrations(realPglite);
			logInfo("✅ Database initialized in MAIN mode");
		} else {
			// Proxy mode should never reach here - it's handled by DatabaseServiceProxy
			// This is just a safety check
			throw new Error(
				`PROXY mode should not initialize database here. Use DatabaseServiceProxy instead.`,
			);
		}

		// Create Drizzle instance (type-safe - both implement compatible interfaces)
		// Since PGliteSharedProxy implements the same interface as PGlite, this is safe
		db = drizzle(pgliteInstance as PGlite, { schema });

		logInfo(
			`✅ Database initialized successfully in ${config.mode.toUpperCase()} mode`,
		);
		return db;
	} catch (error) {
		logError("❌ Database initialization failed:", error);
		throw error;
	}
}

// Get database instance (must call initDB first)
export function getDB() {
	if (!db) {
		throw new Error("Database not initialized. Call initDB() first.");
	}
	return db;
}

// Get raw PGlite instance for direct SQL queries
export function getPGLite() {
	if (!pgliteInstance) {
		throw new Error("Database not initialized. Call initDB() first.");
	}
	return pgliteInstance;
}

// Get current database mode
export function getCurrentMode(): DatabaseMode | null {
	return currentMode;
}

// Check if database is in main mode (has real PGlite instance)
export function isMainMode(): boolean {
	return currentMode === DatabaseMode.MAIN;
}

// Check if database is in proxy mode
export function isProxyMode(): boolean {
	return currentMode === DatabaseMode.PROXY;
}

// Health check
export async function healthCheck() {
	try {
		if (!pgliteInstance)
			return { healthy: false, error: "Database not initialized" };

		const result = await pgliteInstance.query("SELECT 1 as test");
		return {
			healthy: true,
			test: result.rows[0],
			mode: currentMode,
		};
	} catch (error) {
		return {
			healthy: false,
			error: error instanceof Error ? error.message : "Unknown error",
			mode: currentMode,
		};
	}
}

// Close database
export async function closeDB() {
	if (pgliteInstance) {
		await pgliteInstance.close();
		pgliteInstance = null;
		db = null;
		currentMode = null;
	}
}
