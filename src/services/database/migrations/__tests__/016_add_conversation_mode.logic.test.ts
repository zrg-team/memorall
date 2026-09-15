import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { down, up } from "../016_add_conversation_mode";

describe("conversation mode migration", () => {
	let database: PGlite | undefined;

	afterEach(async () => {
		await database?.close();
		database = undefined;
	});

	it("files existing conversations under chat and indexes by mode", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE conversations (
				id serial PRIMARY KEY,
				title text,
				updated_at timestamp NOT NULL DEFAULT now()
			);
			INSERT INTO conversations (title) VALUES ('old chat');
		`);

		await up(database);
		await up(database); // idempotent

		const rows = await database.query<{ mode: string }>(
			"SELECT mode FROM conversations",
		);
		expect(rows.rows).toEqual([{ mode: "chat" }]);

		await database.exec(
			"INSERT INTO conversations (title, mode) VALUES ('clip', 'text-to-speech')",
		);
		const speech = await database.query<{ title: string }>(
			"SELECT title FROM conversations WHERE mode = 'text-to-speech'",
		);
		expect(speech.rows).toEqual([{ title: "clip" }]);

		const index = await database.query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE indexname = 'conversations_mode_updated_idx'",
		);
		expect(index.rows).toHaveLength(1);

		await down(database);
		const columns = await database.query<{ column_name: string }>(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'conversations'",
		);
		expect(columns.rows.map((row) => row.column_name)).not.toContain("mode");
	});
});
