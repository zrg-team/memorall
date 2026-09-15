import type { PGlite } from "@electric-sql/pglite";

/**
 * Conversations now belong to a workspace: chat, or one of the media studios
 * (speech, transcription, image generation, ...). Every existing conversation
 * is a chat. A real column rather than a metadata key, so the sidebar's
 * newest-first listing per workspace stays an index scan.
 */
export const up = async (pg: PGlite) => {
	await pg.exec(`
		ALTER TABLE conversations
		ADD COLUMN IF NOT EXISTS mode VARCHAR(32) NOT NULL DEFAULT 'chat';

		CREATE INDEX IF NOT EXISTS conversations_mode_updated_idx
			ON conversations (mode, updated_at DESC);
	`);
};

export const down = async (pg: PGlite) => {
	await pg.exec(`
		DROP INDEX IF EXISTS conversations_mode_updated_idx;
		ALTER TABLE conversations DROP COLUMN IF EXISTS mode;
	`);
};
