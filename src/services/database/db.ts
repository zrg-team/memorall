// Standalone database service - Simple and Direct
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { logError, logInfo } from "@/utils/logger";

// Import all schemas
import * as conversationSchema from "./entities/conversation";
import * as messageSchema from "./entities/message";
import * as sourcesSchema from "./entities/sources";
import * as nodesSchema from "./entities/nodes";
import * as edgesSchema from "./entities/edges";
import * as sourceNodesSchema from "./entities/source-nodes";
import * as sourceEdgesSchema from "./entities/source-edges";
import * as encryptionSchema from "./entities/encryption";
import * as configurationSchema from "./entities/configuration";
import * as rememberedContentSchema from "./entities/remembered-contents";

import { runMigrations } from "./migrations";

// Export schemas for direct access
export const schema = {
	// Conversation entities
	conversations: conversationSchema.conversations,
	messages: messageSchema.messages,
	// Knowledge graph entities
	sources: sourcesSchema.sources,
	nodes: nodesSchema.nodes,
	edges: edgesSchema.edges,
	sourceNodes: sourceNodesSchema.sourceNodes,
	sourceEdges: sourceEdgesSchema.sourceEdges,
	// Encryption entities
	encryption: encryptionSchema.encryption,
	// Generic configurations (JSONB)
	configurations: configurationSchema.configurations,
	// Remembered content from "Remember this" feature
	rememberedContent: rememberedContentSchema.rememberedContent,
};

// Export types
export type {
	Conversation,
	NewConversation,
} from "./entities/conversation";

export type {
	Message,
	NewMessage,
} from "./entities/message";

export type {
	Source,
	NewSource,
} from "./entities/sources";

export type {
	Node,
	NewNode,
} from "./entities/nodes";

export type {
	Edge,
	NewEdge,
} from "./entities/edges";

export type {
	SourceNode,
	NewSourceNode,
} from "./entities/source-nodes";

export type {
	SourceEdge,
	NewSourceEdge,
} from "./entities/source-edges";

export type {
	Encryption,
	NewEncryption,
} from "./entities/encryption";
export type {
	Configuration,
	NewConfiguration,
} from "./entities/configuration";

export type {
	RememberedContent,
	NewRememberedContent,
} from "./entities/remembered-contents";

// Database instance
let pglite: PGlite | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

// Initialize database
export async function initDB(dataDir?: string) {
	if (db) return db;

	try {
		// Create PGlite instance with IndexedDB persistence for browser extensions
		pglite = new PGlite("idb://memorall-db", {
			extensions: { vector, uuid_ossp, pg_trgm },
		});
		await pglite.waitReady;

		// Create Drizzle instance
		db = drizzle(pglite, { schema });

		// Run database migrations
		await runMigrations(pglite);

		logInfo("✅ Database initialized successfully");
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
	if (!pglite) {
		throw new Error("Database not initialized. Call initDB() first.");
	}
	return pglite;
}

// Health check
export async function healthCheck() {
	try {
		if (!pglite) return { healthy: false, error: "Database not initialized" };

		const result = await pglite.query("SELECT 1 as test");
		return { healthy: true, test: result.rows[0] };
	} catch (error) {
		return {
			healthy: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

// Close database
export async function closeDB() {
	if (pglite) {
		await pglite.close();
		pglite = null;
		db = null;
	}
}
