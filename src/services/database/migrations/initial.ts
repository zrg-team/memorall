import type { PGlite } from "@electric-sql/pglite";

export const up = async (pg: PGlite) => {
	await pg.exec(`
    -- Enable extensions
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

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
  `);
};
