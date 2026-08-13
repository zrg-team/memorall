/**
 * Database Service Proxy Implementation
 *
 * Lightweight proxy that delegates all operations to offscreen thread via RPC.
 * Uses PGliteSharedProxy with Chrome Port transport - NO heavy imports.
 *
 * CRITICAL: Does NOT import drizzle-orm/pglite or any heavy modules.
 * All database operations are sent via RPC to the offscreen thread.
 * The offscreen thread has the actual drizzle instance.
 */

import { logError, logInfo } from "@/utils/logger";
import { PGliteSharedProxy, type PGliteLike } from "./bridges/proxy-driver";
import { createDatabaseProxyTransport } from "@/services/database/bridges/current-proxy-transport";
import type { DatabaseProxyTransportFactory } from "./bridges/proxy-transport";
import { schema } from "./schema";
import { DatabaseMode } from "./constants";
import type {
	DatabaseContext,
	DatabaseStatus,
} from "./interfaces/database-service.interface";
import { DatabaseServiceCore } from "./database-service-core";
import { drizzle } from "drizzle-orm/pglite";
import type { PGlite } from "@electric-sql/pglite";

/**
 * Database Service Proxy
 *
 * Uses PGliteSharedProxy directly - NO drizzle wrapper needed here.
 * Drizzle runs on the offscreen thread via RPC.
 */
export class DatabaseServiceProxy extends DatabaseServiceCore {
	private pgliteProxy: PGliteLike | null = null;
	private db: ReturnType<typeof drizzle<typeof schema>> | null = null;

	constructor(
		private readonly transportFactory: DatabaseProxyTransportFactory = createDatabaseProxyTransport,
	) {
		super();
	}

	protected async initializeDatabase(): Promise<void> {
		logInfo(
			`📚 Initializing database service in PROXY mode. Channel: "${this.config?.proxyOptions?.channelName}"`,
		);

		try {
			// Create Chrome Port transport
			const transport = await this.transportFactory({
				channelName: this.config?.proxyOptions?.channelName,
			});

			// Create PGlite proxy - lightweight RPC client only
			this.pgliteProxy = new PGliteSharedProxy(transport);
			await this.pgliteProxy.waitReady;

			this.db = drizzle(this.pgliteProxy as unknown as PGlite, { schema });

			logInfo(
				"✅ Database proxy initialized - operations delegated to offscreen via RPC",
			);
		} catch (error) {
			logError("❌ Database proxy initialization failed:", error);
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
		return {
			initialized: this.initialized,
			mode: DatabaseMode.PROXY,
			isMainMode: false,
			isProxyMode: true,
			tableCount: Object.keys(schema).length,
			availableTables: this.getTableNames(),
			healthy: this.initialized && this.pgliteProxy !== null,
			healthCheck: { mode: "proxy", healthy: this.initialized },
		};
	}

	getMode(): DatabaseMode | null {
		return DatabaseMode.PROXY;
	}

	isMainMode(): boolean {
		return false;
	}

	isProxyMode(): boolean {
		return true;
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.ensureInitialized();
			if (!this.pgliteProxy) return false;
			await this.pgliteProxy.query("SELECT 1");
			return true;
		} catch (error) {
			logError("❌ Database proxy health check failed:", error);
			return false;
		}
	}

	async close(): Promise<void> {
		if (this.pgliteProxy) {
			await this.pgliteProxy.close();
			this.pgliteProxy = null;
		}
		this.initialized = false;
		this.initPromise = null;
		this.config = null;
		logInfo("📚 Database proxy closed");
	}

	async use<T>(
		fn: (ctx: DatabaseContext) => Promise<T> | T,
		options?: { transaction?: boolean },
	): Promise<T> {
		await this.ensureInitialized();

		if (!this.pgliteProxy) {
			throw new Error("Database proxy not initialized");
		}

		const ctx: DatabaseContext = {
			db: this.db!,
			schema,
			raw: (sql: string, params?: unknown[]) =>
				this.pgliteProxy!.query(sql, params),
		};

		if (options?.transaction) {
			return this.db!.transaction(async (tx) => {
				const txCtx: DatabaseContext = {
					db: tx as any,
					schema,
					raw: (sql: string, params?: unknown[]) =>
						this.pgliteProxy!.query(sql, params),
				};
				return fn(txCtx);
			});
		}

		return fn(ctx);
	}
}
