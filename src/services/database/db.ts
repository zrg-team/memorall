// Standalone database service - Simple and Direct
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";

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
import { logError, logInfo } from "@/utils/logger";

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
			extensions: { vector, uuid_ossp },
		});
		await pglite.waitReady;

		// Create Drizzle instance
		db = drizzle(pglite, { schema });

		// Create tables
		await pglite.exec(`
      -- Enable extensions
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- Conversations (UUID primary key)
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Messages (UUID ids, FK to conversations.id)
      CREATE TABLE IF NOT EXISTS messages (
        uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'text',
        content TEXT NOT NULL,
        complex_content JSONB,
        embedding VECTOR(768),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Knowledge Graph: Sources
      CREATE TABLE IF NOT EXISTS sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type TEXT,
        raw TEXT,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        reference_time TIMESTAMP,
        group_id UUID,
        weight REAL DEFAULT 1.0,
        embedding VECTOR(768),
        search_vector TEXT,
        status TEXT DEFAULT 'pending',
        status_valid_from TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Knowledge Graph: Nodes
      CREATE TABLE IF NOT EXISTS nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        node_type TEXT NOT NULL,
        name TEXT NOT NULL,
        summary TEXT,
        attributes JSONB DEFAULT '{}',
        group_id UUID,
        name_embedding VECTOR(768),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Knowledge Graph: Edges
      CREATE TABLE IF NOT EXISTS edges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_id UUID NOT NULL REFERENCES nodes(id),
        destination_id UUID NOT NULL REFERENCES nodes(id),
        edge_type TEXT NOT NULL,
        fact_text TEXT,
        valid_at TIMESTAMP,
        invalid_at TIMESTAMP,
        recorded_at TIMESTAMP DEFAULT NOW() NOT NULL,
        attributes JSONB DEFAULT '{}',
        group_id UUID,
        is_current BOOLEAN DEFAULT true,
        provenance_weight_cache REAL,
        provenance_count_cache INTEGER,
        fact_embedding VECTOR(768),
        type_embedding VECTOR(768),
        search_vector TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Knowledge Graph: Source-Node Junction
      CREATE TABLE IF NOT EXISTS source_nodes (
        source_id UUID NOT NULL REFERENCES sources(id),
        node_id UUID NOT NULL REFERENCES nodes(id),
        relation TEXT NOT NULL,
        attributes JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        PRIMARY KEY (source_id, node_id)
      );

      -- Knowledge Graph: Source-Edge Junction
      CREATE TABLE IF NOT EXISTS source_edges (
        source_id UUID NOT NULL REFERENCES sources(id),
        edge_id UUID NOT NULL REFERENCES edges(id),
        relation TEXT NOT NULL,
        link_weight REAL DEFAULT 1.0,
        attributes JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        PRIMARY KEY (source_id, edge_id)
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS messages_role_idx ON messages(role);

      -- Knowledge Graph Indexes
      CREATE INDEX IF NOT EXISTS sources_target_type_idx ON sources(target_type);
      CREATE INDEX IF NOT EXISTS sources_target_id_idx ON sources(target_id);
      CREATE INDEX IF NOT EXISTS sources_name_idx ON sources(name);
      CREATE INDEX IF NOT EXISTS sources_group_id_idx ON sources(group_id);
      CREATE INDEX IF NOT EXISTS sources_reference_time_idx ON sources(reference_time);
      CREATE INDEX IF NOT EXISTS sources_weight_idx ON sources(weight);
      CREATE INDEX IF NOT EXISTS sources_status_idx ON sources(status);

      CREATE INDEX IF NOT EXISTS nodes_node_type_idx ON nodes(node_type);
      CREATE INDEX IF NOT EXISTS nodes_name_idx ON nodes(name);
      CREATE INDEX IF NOT EXISTS nodes_group_id_idx ON nodes(group_id);
      CREATE INDEX IF NOT EXISTS nodes_summary_idx ON nodes(summary);

      CREATE INDEX IF NOT EXISTS edges_source_id_idx ON edges(source_id);
      CREATE INDEX IF NOT EXISTS edges_destination_id_idx ON edges(destination_id);
      CREATE INDEX IF NOT EXISTS edges_edge_type_idx ON edges(edge_type);
      CREATE INDEX IF NOT EXISTS edges_group_id_idx ON edges(group_id);
      CREATE INDEX IF NOT EXISTS edges_is_current_idx ON edges(is_current);
      CREATE INDEX IF NOT EXISTS edges_valid_at_idx ON edges(valid_at);
      CREATE INDEX IF NOT EXISTS edges_recorded_at_idx ON edges(recorded_at);

      CREATE INDEX IF NOT EXISTS source_nodes_source_id_idx ON source_nodes(source_id);
      CREATE INDEX IF NOT EXISTS source_nodes_node_id_idx ON source_nodes(node_id);
      CREATE INDEX IF NOT EXISTS source_nodes_relation_idx ON source_nodes(relation);

      CREATE INDEX IF NOT EXISTS source_edges_source_id_idx ON source_edges(source_id);
      CREATE INDEX IF NOT EXISTS source_edges_edge_id_idx ON source_edges(edge_id);
      CREATE INDEX IF NOT EXISTS source_edges_relation_idx ON source_edges(relation);
      CREATE INDEX IF NOT EXISTS source_edges_link_weight_idx ON source_edges(link_weight);

      -- Encryption table for encrypted data
      CREATE TABLE IF NOT EXISTS encryption (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key TEXT NOT NULL UNIQUE,
        advanced_seed TEXT,
        encrypted_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Encryption indexes
      CREATE INDEX IF NOT EXISTS encryption_key_idx ON encryption(key);

      -- Generic configurations table (JSONB)
      CREATE TABLE IF NOT EXISTS configurations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        key TEXT NOT NULL UNIQUE,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS configurations_key_idx ON configurations(key);

      -- Remembered Content table (enhanced version of remembered_pages)
      CREATE TABLE IF NOT EXISTS remembered_content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_type TEXT NOT NULL DEFAULT 'webpage',
        source_url TEXT,
        original_url TEXT,
        title TEXT NOT NULL,
        raw_content TEXT NOT NULL,
        clean_content TEXT NOT NULL,
        text_content TEXT NOT NULL,
        source_metadata JSONB NOT NULL DEFAULT '{}',
        extraction_metadata JSONB NOT NULL DEFAULT '{}',
        embedding VECTOR(768),
        search_vector TEXT,
        tags JSONB DEFAULT '[]',
        notes TEXT,
        content_length REAL DEFAULT 0,
        readability_score REAL,
        is_archived BOOLEAN DEFAULT false,
        is_favorite BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );


      -- Indexes for remembered_content
      CREATE INDEX IF NOT EXISTS remembered_content_source_type_idx ON remembered_content(source_type);
      CREATE INDEX IF NOT EXISTS remembered_content_source_url_idx ON remembered_content(source_url);
      CREATE INDEX IF NOT EXISTS remembered_content_title_idx ON remembered_content(title);
      CREATE INDEX IF NOT EXISTS remembered_content_created_at_idx ON remembered_content(created_at);
      CREATE INDEX IF NOT EXISTS remembered_content_updated_at_idx ON remembered_content(updated_at);
      CREATE INDEX IF NOT EXISTS remembered_content_is_archived_idx ON remembered_content(is_archived);
      CREATE INDEX IF NOT EXISTS remembered_content_is_favorite_idx ON remembered_content(is_favorite);
      CREATE INDEX IF NOT EXISTS remembered_content_content_length_idx ON remembered_content(content_length);
      CREATE INDEX IF NOT EXISTS remembered_content_source_type_created_idx ON remembered_content(source_type, created_at);
      CREATE INDEX IF NOT EXISTS remembered_content_status_created_idx ON remembered_content(is_archived, created_at);
      CREATE INDEX IF NOT EXISTS remembered_content_favorite_created_idx ON remembered_content(is_favorite, created_at);
    `);

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
