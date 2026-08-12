import type { PGlite } from "@electric-sql/pglite";
import { up as createBoundedIndex } from "./014_add_message_history_search_index";

/** Rebuild version 14's index for installations that already applied it. */
export const up = async (pg: PGlite) => {
	await pg.exec(`DROP INDEX IF EXISTS messages_thread_history_search_idx;`);
	await createBoundedIndex(pg);
};

export const down = async (pg: PGlite) => {
	await pg.exec(`DROP INDEX IF EXISTS messages_thread_history_search_idx;`);
};
