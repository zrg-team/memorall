import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { down, up } from "../017_add_model_usage";

describe("model usage migration", () => {
	let database: PGlite | undefined;

	afterEach(async () => {
		await database?.close();
		database = undefined;
	});

	it("keeps one row per model request, and lets the agent go", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE flows (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
			INSERT INTO flows (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Coder');
		`);

		await up(database);
		await up(database); // idempotent

		await database.exec(`
			INSERT INTO model_usage (source, tool, agent_flow_id, session_id, title, provider, model, usage)
			VALUES ('pi-code', 'memon_code', '00000000-0000-0000-0000-000000000001', 's1', 'pi code · ~', 'openrouter', 'm', '{"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}');
		`);
		await database.exec("DELETE FROM flows");
		const rows = await database.query<{
			source: string;
			agent_flow_id: string | null;
			usage: { total_tokens: number };
		}>("SELECT source, agent_flow_id, usage FROM model_usage");
		expect(rows.rows).toEqual([
			{
				source: "pi-code",
				agent_flow_id: null,
				usage: expect.objectContaining({ total_tokens: 12 }),
			},
		]);

		const index = await database.query<{ indexname: string }>(
			"SELECT indexname FROM pg_indexes WHERE indexname = 'model_usage_created_at_idx'",
		);
		expect(index.rows).toHaveLength(1);

		await down(database);
		const tables = await database.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_name = 'model_usage'",
		);
		expect(tables.rows).toEqual([]);
	});
});
