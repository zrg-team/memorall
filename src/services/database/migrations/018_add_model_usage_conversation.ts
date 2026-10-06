import type { PGlite } from "@electric-sql/pglite";

/**
 * The chat a model request outside its replies was made for: pi code
 * working on what the chat's agent handed it. The chat's cost counts those
 * requests next to its own replies. Older rows, and requests no chat asked
 * for (the user typing to pi), have none.
 */
export const up = async (pg: PGlite) => {
	await pg.exec(`
		ALTER TABLE model_usage
		ADD COLUMN IF NOT EXISTS conversation_id UUID
			REFERENCES conversations(id) ON DELETE SET NULL;

		CREATE INDEX IF NOT EXISTS model_usage_conversation_idx
			ON model_usage (conversation_id)
			WHERE conversation_id IS NOT NULL;
	`);
};

export const down = async (pg: PGlite) => {
	await pg.exec(`
		DROP INDEX IF EXISTS model_usage_conversation_idx;
		ALTER TABLE model_usage DROP COLUMN IF EXISTS conversation_id;
	`);
};
