import type { PGlite } from "@electric-sql/pglite";

/**
 * Model requests made outside a chat reply (pi code on an agent's computer,
 * Studio runs there), one row each, so the Usage page counts their tokens
 * and cost next to the chat's.
 */
export const up = async (pg: PGlite) => {
	await pg.exec(`
		CREATE TABLE IF NOT EXISTS model_usage (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			source TEXT NOT NULL,
			tool TEXT,
			agent_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL,
			session_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL DEFAULT '',
			usage JSONB NOT NULL,
			created_at TIMESTAMP DEFAULT NOW() NOT NULL
		);

		CREATE INDEX IF NOT EXISTS model_usage_created_at_idx
			ON model_usage (created_at);
	`);
};

export const down = async (pg: PGlite) => {
	await pg.exec(`
		DROP INDEX IF EXISTS model_usage_created_at_idx;
		DROP TABLE IF EXISTS model_usage;
	`);
};
