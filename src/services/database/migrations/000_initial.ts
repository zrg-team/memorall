import type { PGlite } from "@electric-sql/pglite";
import { toFullTableSQL } from "../utils/schema-to-sql";
import {
	conversation,
	edge,
	message,
	node,
	source,
	sourceEdge,
	sourceNode,
	topic,
	encryption,
	configuration,
	rememberedContent,
	nodeManualIndexes,
	edgeManualIndexes,
} from "../entities";

export const up = async (pg: PGlite) => {
	const conversationTable = toFullTableSQL(conversation);
	const messagesTable = toFullTableSQL(message);
	const topicsTable = toFullTableSQL(topic);
	const sourcesTable = toFullTableSQL(source);
	const nodesTable = toFullTableSQL(node);
	const edgesTable = toFullTableSQL(edge);
	const sourceNodesTable = toFullTableSQL(sourceNode);
	const sourceEdgesTable = toFullTableSQL(sourceEdge);
	const encryptionTable = toFullTableSQL(encryption);
	const configurationsTable = toFullTableSQL(configuration);
	const rememberedContentTable = toFullTableSQL(rememberedContent);

	const sql = `
    -- Enable extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    ${conversationTable.table}
    ${conversationTable.indexes.join("\n")}

    ${messagesTable.table}
    ${messagesTable.indexes.join("\n")}

    ${topicsTable.table}
    ${topicsTable.indexes.join("\n")}

    ${sourcesTable.table}
    ${sourcesTable.indexes.join("\n")}

    ${nodesTable.table}
    ${nodesTable.indexes.join("\n")}

    ${edgesTable.table}
    ${edgesTable.indexes.join("\n")}

    ${sourceNodesTable.table}
    ${sourceNodesTable.indexes.join("\n")}

    ${sourceEdgesTable.table}
    ${sourceEdgesTable.indexes.join("\n")}

    ${encryptionTable.table}
    ${encryptionTable.indexes.join("\n")}

    ${rememberedContentTable.table}
    ${rememberedContentTable.indexes.join("\n")}

    ${configurationsTable.table}
    ${configurationsTable.indexes.join("\n")}

    ${nodeManualIndexes.join("\n")}
    ${edgeManualIndexes.join("\n")}

    -- Trigram indexes for similarity search
    CREATE INDEX IF NOT EXISTS nodes_name_trgm_idx ON nodes USING GIN (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS nodes_summary_trgm_idx ON nodes USING GIN (summary gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS edges_fact_text_trgm_idx ON edges USING GIN (fact_text gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS edges_edge_type_trgm_idx ON edges USING GIN (edge_type gin_trgm_ops);

    -- SQL Functions for trigram search
    CREATE OR REPLACE FUNCTION search_nodes_trigram(
      search_text TEXT,
      similarity_threshold REAL DEFAULT 0.1,
      result_limit INTEGER DEFAULT 50
    )
    RETURNS TABLE(
      id UUID,
      node_type TEXT,
      name TEXT,
      summary TEXT,
      attributes JSONB,
      group_id UUID,
      name_embedding VECTOR(768),
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      similarity_score REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        n.id,
        n.node_type,
        n.name,
        n.summary,
        n.attributes,
        n.group_id,
        n.name_embedding,
        n.created_at,
        n.updated_at,
        GREATEST(
          COALESCE(similarity(n.name, search_text), 0),
          COALESCE(similarity(COALESCE(n.summary, ''), search_text), 0)
        ) as similarity_score
      FROM nodes n
      WHERE (
        similarity(n.name, search_text) > similarity_threshold
        OR similarity(COALESCE(n.summary, ''), search_text) > similarity_threshold
      )
      ORDER BY similarity_score DESC
      LIMIT result_limit;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION search_edges_trigram(
      search_text TEXT,
      similarity_threshold REAL DEFAULT 0.1,
      result_limit INTEGER DEFAULT 50
    )
    RETURNS TABLE(
      id UUID,
      source_id UUID,
      destination_id UUID,
      edge_type TEXT,
      fact_text TEXT,
      valid_at TIMESTAMP,
      invalid_at TIMESTAMP,
      recorded_at TIMESTAMP,
      attributes JSONB,
      group_id UUID,
      is_current BOOLEAN,
      provenance_weight_cache REAL,
      provenance_count_cache INTEGER,
      fact_embedding VECTOR(768),
      type_embedding VECTOR(768),
      search_vector TEXT,
      created_at TIMESTAMP,
      updated_at TIMESTAMP,
      similarity_score REAL
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT
        e.id,
        e.source_id,
        e.destination_id,
        e.edge_type,
        e.fact_text,
        e.valid_at,
        e.invalid_at,
        e.recorded_at,
        e.attributes,
        e.group_id,
        e.is_current,
        e.provenance_weight_cache,
        e.provenance_count_cache,
        e.fact_embedding,
        e.type_embedding,
        e.search_vector,
        e.created_at,
        e.updated_at,
        GREATEST(
          COALESCE(similarity(COALESCE(e.fact_text, ''), search_text), 0),
          COALESCE(similarity(e.edge_type, search_text), 0)
        ) as similarity_score
      FROM edges e
      WHERE (
        similarity(COALESCE(e.fact_text, ''), search_text) > similarity_threshold
        OR similarity(e.edge_type, search_text) > similarity_threshold
      )
      ORDER BY similarity_score DESC
      LIMIT result_limit;
    END;
    $$ LANGUAGE plpgsql;
  `;
	await pg.exec(sql);
};
