/**
 * Database Service Main Implementation
 *
 * Thin wrapper around db.ts for offscreen thread.
 * db.ts already handles PGlite initialization properly.
 */

import { logError, logInfo } from "@/utils/logger";
import {
	initDB,
	getDB,
	getPGLite,
	healthCheck,
	closeDB,
	getCurrentMode,
	isMainMode,
	isProxyMode,
} from "./db";
import { schema } from "./schema";
import { DatabaseMode } from "./constants";
import type {
	DatabaseContext,
	DatabaseStatus,
} from "./interfaces/database-service.interface";
import { DatabaseServiceCore } from "./database-service-core";
import { getDatabaseRpcServer } from "@/services/database/bridges/current-rpc-server";

export class DatabaseServiceMain extends DatabaseServiceCore {
	protected async initializeDatabase(): Promise<void> {
		logInfo(
			`📚 Initializing database service in "MAIN" mode. Channel: "${this.config!.proxyOptions?.channelName}"`,
		);

		try {
			// Start RPC handler FIRST (before database init) so listener is ready
			// when popup tries to connect - prevents "Receiving end does not exist" errors

			// db.ts handles both main and proxy modes correctly
			await initDB(this.config!);

			const channelName = this.config!.proxyOptions?.channelName;
			if (channelName) {
				const rpcHandler = getDatabaseRpcServer();
				rpcHandler.startListening(channelName);
			}

			logInfo("✅ Database service initialized successfully");
		} catch (error) {
			logError("❌ Database service initialization failed:", error);
			throw error;
		}
	}

	hasTable(tableName: string): boolean {
		return tableName in schema;
	}

	getTableNames(): string[] {
		return Object.keys(schema);
	}

	async getStatus(): Promise<DatabaseStatus> {
		const status: DatabaseStatus = {
			initialized: this.initialized,
			mode: getCurrentMode(),
			isMainMode: isMainMode(),
			isProxyMode: isProxyMode(),
			tableCount: Object.keys(schema).length,
			availableTables: this.getTableNames(),
			healthy: false,
			healthCheck: null,
		};

		if (this.initialized) {
			try {
				status.healthCheck = await healthCheck();
				status.healthy = (status.healthCheck as { healthy: boolean }).healthy;
			} catch (error) {
				status.healthCheck = {
					healthy: false,
					error: error instanceof Error ? error.message : "Unknown error",
				};
			}
		}

		return status;
	}

	getMode(): DatabaseMode | null {
		return getCurrentMode();
	}

	isMainMode(): boolean {
		return isMainMode();
	}

	isProxyMode(): boolean {
		return isProxyMode();
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.ensureInitialized();
			const result = await healthCheck();
			return result.healthy;
		} catch (error) {
			logError("❌ Database health check failed:", error);
			return false;
		}
	}

	async close(): Promise<void> {
		if (
			this.config?.mode === DatabaseMode.MAIN &&
			this.config.proxyOptions?.channelName
		) {
			const rpcHandler = getDatabaseRpcServer();
			rpcHandler.stop();
			logInfo("📡 RPC handler stopped");
		}

		await closeDB();
		this.initialized = false;
		this.initPromise = null;
		this.config = null;
		logInfo("📚 Database service closed");
	}

	async use<T>(
		fn: (ctx: DatabaseContext) => Promise<T> | T,
		options?: { transaction?: boolean },
	): Promise<T> {
		await this.ensureInitialized();

		const db = getDB();
		const pglite = getPGLite();

		const ctx: DatabaseContext = {
			db,
			schema,
			raw: (sql: string, params?: unknown[]) => pglite.query(sql, params),
		};

		if (options?.transaction) {
			return db.transaction(async (tx) => {
				const txCtx: DatabaseContext = {
					db: tx as any,
					schema,
					raw: (sql: string, params?: unknown[]) => pglite.query(sql, params),
				};
				return fn(txCtx);
			});
		}

		return fn(ctx);
	}
}
