import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../015_bound_message_history_search_index";

describe("bounded thread history search index migration", () => {
	let database: PGlite | undefined;

	afterEach(async () => {
		await database?.close();
		database = undefined;
	});

	it("replaces the legacy unbounded expression index", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE messages (content text NOT NULL, parts jsonb);
			CREATE INDEX messages_thread_history_search_idx
				ON messages USING gin (
					to_tsvector('simple'::regconfig, coalesce(content, '') || ' ' || coalesce(parts::text, ''))
				);
		`);

		await up(database);
		const result = await database.query<{ indexdef: string }>(`
			SELECT indexdef FROM pg_indexes
			WHERE indexname = 'messages_thread_history_search_idx'
		`);
		expect(result.rows[0]?.indexdef.toLowerCase()).toContain('"left"(');
		expect(result.rows[0]?.indexdef).toContain("32768");
	});
});
