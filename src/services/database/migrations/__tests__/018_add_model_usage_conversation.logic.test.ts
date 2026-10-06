import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { up as addModelUsage } from "../017_add_model_usage";
import { down, up } from "../018_add_model_usage_conversation";

describe("model usage conversation migration", () => {
	let database: PGlite | undefined;

	afterEach(async () => {
		await database?.close();
		database = undefined;
	});

	it("books a request to the chat it was made for, and lets the chat go", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE flows (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
			CREATE TABLE conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
			INSERT INTO conversations (id) VALUES ('00000000-0000-0000-0000-000000000002');
		`);
		await addModelUsage(database);
		await database.exec(`
			INSERT INTO model_usage (source, session_id, usage)
			VALUES ('pi-code', 'before', '{"prompt_tokens": 1}');
		`);

		await up(database);
		await up(database); // idempotent

		await database.exec(`
			INSERT INTO model_usage (source, session_id, conversation_id, usage)
			VALUES ('pi-code', 's1', '00000000-0000-0000-0000-000000000002', '{"prompt_tokens": 2}');
		`);
		const booked = await database.query<{
			session_id: string;
			conversation_id: string | null;
		}>(
			"SELECT session_id, conversation_id FROM model_usage ORDER BY session_id",
		);
		expect(booked.rows).toEqual([
			{ session_id: "before", conversation_id: null },
			{
				session_id: "s1",
				conversation_id: "00000000-0000-0000-0000-000000000002",
			},
		]);

		await database.exec("DELETE FROM conversations");
		const kept = await database.query<{ conversation_id: string | null }>(
			"SELECT conversation_id FROM model_usage WHERE session_id = 's1'",
		);
		expect(kept.rows).toEqual([{ conversation_id: null }]);

		await down(database);
		const columns = await database.query<{ column_name: string }>(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'model_usage' AND column_name = 'conversation_id'",
		);
		expect(columns.rows).toEqual([]);
	});
});
