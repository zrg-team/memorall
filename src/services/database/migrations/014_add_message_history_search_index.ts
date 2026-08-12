import type { PGlite } from "@electric-sql/pglite";

export const up = async (pg: PGlite) => {
	await pg.exec(`
		CREATE INDEX IF NOT EXISTS messages_thread_history_search_idx
			ON messages USING gin (
				to_tsvector(
					'simple'::regconfig,
					coalesce(content, '') || ' ' || coalesce(parts::text, '')
				)
			);
	`);
};

export const down = async (pg: PGlite) => {
	await pg.exec(`
		DROP INDEX IF EXISTS messages_thread_history_search_idx;
	`);
};
