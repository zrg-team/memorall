import { logError, logInfo } from "@/utils/logger";
import {
	initDB,
	getDB,
	getPGLite,
	healthCheck,
	closeDB,
	schema,
	DatabaseMode,
	getCurrentMode,
	isMainMode,
	isProxyMode,
} from "./db";
import type { DatabaseConfig } from "./db";
import { DatabaseRpcHandler } from "./bridges/rpc-handler";

// The database type is already correct from getDB - it includes the schema and query API
type DatabaseWithSchema = ReturnType<typeof getDB>;
import type {
	Conversation,
	NewConversation,
	Message,
	NewMessage,
	Source,
	NewSource,
	Node,
	NewNode,
	Edge,
	NewEdge,
	SourceNode,
	NewSourceNode,
	SourceEdge,
	NewSourceEdge,
	Encryption,
	NewEncryption,
	Configuration,
	NewConfiguration,
	RememberedContent,
	NewRememberedContent,
} from "./db";

// Table registry with proper type mapping
interface TableRegistry {
	conversations: {
		table: typeof schema.conversations;
		select: Conversation;
		insert: NewConversation;
	};
	messages: {
		table: typeof schema.messages;
		select: Message;
		insert: NewMessage;
	};
	sources: {
		table: typeof schema.sources;
		select: Source;
		insert: NewSource;
	};
	nodes: {
		table: typeof schema.nodes;
		select: Node;
		insert: NewNode;
	};
	edges: {
		table: typeof schema.edges;
		select: Edge;
		insert: NewEdge;
	};
	sourceNodes: {
		table: typeof schema.sourceNodes;
		select: SourceNode;
		insert: NewSourceNode;
	};
	sourceEdges: {
		table: typeof schema.sourceEdges;
		select: SourceEdge;
		insert: NewSourceEdge;
	};
	encryption: {
		table: typeof schema.encryption;
		select: Encryption;
		insert: NewEncryption;
	};
	configurations: {
		table: typeof schema.configurations;
		select: Configuration;
		insert: NewConfiguration;
	};
	rememberedContent: {
		table: typeof schema.rememberedContent;
		select: RememberedContent;
		insert: NewRememberedContent;
	};
}

// Database service class
export class DatabaseService {
	private static instance: DatabaseService;
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private config: DatabaseConfig | null = null;

	constructor() {}

	static getInstance(): DatabaseService {
		if (!DatabaseService.instance) {
			DatabaseService.instance = new DatabaseService();
		}
		return DatabaseService.instance;
	}

	async initialize(config?: DatabaseConfig): Promise<void> {
		if (this.initialized) return;
		if (this.initPromise) return this.initPromise;

		this.config = config || { mode: DatabaseMode.MAIN };
		this.initPromise = this.initializeDatabase();
		await this.initPromise;
		this.initialized = true;
	}

	private async initializeDatabase(): Promise<void> {
		logInfo(
			`📚 Initializing database service in ${this.config?.mode.toUpperCase()} mode...`,
		);

		try {
			// Initialize the database with configuration
			await initDB(this.config!);

			// If in main mode, start RPC handler to serve proxy requests
			if (this.config!.mode === DatabaseMode.MAIN) {
				const rpcHandler = DatabaseRpcHandler.getInstance();
				rpcHandler.startListening(this.config!.proxyOptions?.channelName);
				logInfo("📡 RPC handler started for proxy connections");
			}

			logInfo("✅ Database service initialized successfully");
		} catch (error) {
			logError("❌ Database service initialization failed:", error);
			throw error;
		}
	}

	// Check if database is ready
	isReady(): boolean {
		return this.initialized;
	}

	// Get table by name with type safety
	async getTable<K extends keyof TableRegistry>(
		tableName: K,
	): Promise<TableRegistry[K]["table"]> {
		// Wait for initialization if not ready
		if (!this.initialized) {
			await this.initialize();
		}

		const table = schema[tableName];
		if (!table) {
			throw new Error(
				`Table '${tableName}' not found. Available: ${this.getTableNames().join(", ")}`,
			);
		}

		return table as TableRegistry[K]["table"];
	}

	// Get database instance (waits for initialization)
	async getDatabase() {
		if (!this.initialized) {
			await this.initialize();
		}
		return getDB();
	}

	// Get raw PGlite instance (waits for initialization)
	async getPGLiteInstance() {
		if (!this.initialized) {
			await this.initialize();
		}
		return getPGLite();
	}

	// Check if table exists
	hasTable(tableName: string): boolean {
		return tableName in schema;
	}

	// Get all table names
	getTableNames(): string[] {
		return Object.keys(schema);
	}

	// Get database status
	async getStatus() {
		const status = {
			initialized: this.initialized,
			mode: getCurrentMode(),
			isMainMode: isMainMode(),
			isProxyMode: isProxyMode(),
			tableCount: Object.keys(schema).length,
			availableTables: this.getTableNames(),
			healthy: false,
			healthCheck: null as unknown,
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

	// Get current database mode
	getMode(): DatabaseMode | null {
		return getCurrentMode();
	}

	// Check if in main mode
	isMainMode(): boolean {
		return isMainMode();
	}

	// Check if in proxy mode
	isProxyMode(): boolean {
		return isProxyMode();
	}

	// Get current configuration
	getConfig(): DatabaseConfig | null {
		return this.config;
	}

	// Health check method
	async healthCheck(): Promise<boolean> {
		try {
			if (!this.initialized) {
				await this.initialize();
			}

			const result = await healthCheck();
			return result.healthy;
		} catch (error) {
			logError("❌ Database health check failed:", error);
			return false;
		}
	}

	// Close database connection
	async close(): Promise<void> {
		// Stop RPC handler if in main mode
		if (this.config?.mode === DatabaseMode.MAIN) {
			const rpcHandler = DatabaseRpcHandler.getInstance();
			rpcHandler.stop();
			logInfo("📡 RPC handler stopped");
		}

		await closeDB();
		this.initialized = false;
		this.initPromise = null;
		this.config = null;
		logInfo("📚 Database service closed");
	}

	// Convenience methods for common operations
	async query(sql: string, params?: unknown[]) {
		const pglite = await this.getPGLiteInstance();
		return pglite.query(sql, params);
	}

	async execute(sql: string) {
		const pglite = await this.getPGLiteInstance();
		return pglite.exec(sql);
	}

	// Regular database access
	async use<T>(
		fn: (ctx: {
			db: DatabaseWithSchema;
			query: DatabaseWithSchema["query"];
			schema: typeof schema;
			raw: (sql: string, params?: unknown[]) => Promise<unknown>;
		}) => Promise<T> | T,
	): Promise<T>;

	// Transactional database access
	async use<T>(
		fn: (ctx: {
			db: DatabaseWithSchema;
			query: DatabaseWithSchema["query"];
			schema: typeof schema;
			raw: (sql: string, params?: unknown[]) => Promise<unknown>;
		}) => Promise<T> | T,
		options: { transaction: true },
	): Promise<T>;

	// Implementation
	async use<T>(
		fn: (ctx: {
			db: DatabaseWithSchema;
			query: DatabaseWithSchema["query"];
			schema: typeof schema;
			raw: (sql: string, params?: unknown[]) => Promise<unknown>;
		}) => Promise<T> | T,
		options?: { transaction?: boolean },
	): Promise<T> {
		if (!this.initialized) {
			await this.initialize();
		}

		const db = getDB();
		const pglite = await this.getPGLiteInstance();

		if (options?.transaction) {
			// Transactional context
			return db.transaction(async (tx) => {
				const txCtx = {
					db: tx,
					query: tx.query,
					schema,
					raw: (sql: string, params?: unknown[]) => pglite.query(sql, params),
				};
				return fn(txCtx as unknown as typeof ctx);
			});
		}

		const ctx = {
			db,
			query: db.query,
			schema,
			raw: (sql: string, params?: unknown[]) => pglite.query(sql, params),
		};

		return fn(ctx);
	}

	// Dedicated transaction method with same interface as use()
	async transaction<T>(
		fn: (ctx: {
			db: DatabaseWithSchema;
			query: DatabaseWithSchema["query"];
			schema: typeof schema;
			raw: (sql: string, params?: unknown[]) => Promise<unknown>;
		}) => Promise<T> | T,
	): Promise<T> {
		return this.use(fn, { transaction: true });
	}
}
