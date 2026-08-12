import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { up } from "../014_add_message_history_search_index";
import { createFlowRuntimeVars } from "@/services/flows-legacy/runtime/runtime-context";
import {
	createThreadHistoryReadTool,
	createThreadHistorySearchTool,
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-legacy/tools/thread-history";

describe("thread history search migration", () => {
	let database: PGlite | undefined;
	afterEach(async () => {
		await database?.close();
		database = undefined;
	});

	it("indexes and queries only messages before the trusted separator", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE messages (
				uuid uuid PRIMARY KEY,
				conversation_id uuid NOT NULL,
				type text NOT NULL,
				role text NOT NULL,
				content text NOT NULL,
				parts jsonb,
				complex_content jsonb,
				metadata jsonb,
				created_at timestamp NOT NULL
			);
		`);
		await up(database);
		const conversationId = "10000000-0000-4000-8000-000000000001";
		const beforeId = "20000000-0000-4000-8000-000000000001";
		const separatorId = "30000000-0000-4000-8000-000000000001";
		const afterId = "40000000-0000-4000-8000-000000000001";
		await database.query(
			`INSERT INTO messages VALUES
				($1, $4, 'text', 'assistant', '', $5::jsonb, null, '{}'::jsonb, '2026-08-12T00:00:00Z'),
				($2, $4, 'separator', 'system', '---', null, null, '{}'::jsonb, '2026-08-12T00:01:00Z'),
				($3, $4, 'text', 'assistant', 'secret phrase after boundary', null, null, '{}'::jsonb, '2026-08-12T00:02:00Z')`,
			[
				beforeId,
				separatorId,
				afterId,
				conversationId,
				JSON.stringify([
					{
						role: "assistant",
						content: "first line\nsecret phrase\nlast line",
					},
				]),
			],
		);

		const raw = async <T>(query: string, params?: unknown[]): Promise<T[]> =>
			(await database!.query<T>(query, params)).rows;
		const services = { database: { raw } } as never;
		const context = {
			state: {},
			runtime: createFlowRuntimeVars({
				[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: conversationId,
				[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]: separatorId,
			}),
		};
		const search = await createThreadHistorySearchTool(services).execute(
			{ query: "secret phrase", prefixLines: 1, suffixLines: 1 },
			context,
		);
		const searchContent = (search as { content: string }).content;
		expect(searchContent).toContain(`messageId: ${beforeId}`);
		expect(searchContent).not.toContain(afterId);

		const read = await createThreadHistoryReadTool(services).execute(
			{ messageIds: [beforeId], readAll: true },
			context,
		);
		expect((read as { content: string }).content).toContain(
			"L3| secret phrase",
		);
	});

	it("builds the index when an existing AI2UI message exceeds tsvector limits", async () => {
		database = new PGlite();
		await database.exec(`
			CREATE TABLE messages (
				uuid uuid PRIMARY KEY,
				conversation_id uuid NOT NULL,
				type text NOT NULL,
				role text NOT NULL,
				content text NOT NULL,
				parts jsonb,
				complex_content jsonb,
				metadata jsonb,
				created_at timestamp NOT NULL
			);
		`);
		const largeAi2Ui = Array.from(
			{ length: 120_000 },
			(_, index) => `node${index}`,
		).join(" ");
		await database.query(
			`INSERT INTO messages VALUES
				('20000000-0000-4000-8000-000000000001',
				 '10000000-0000-4000-8000-000000000001',
				 'text', 'assistant', $1, null, null, '{}'::jsonb, now())`,
			[largeAi2Ui],
		);

		await expect(up(database)).resolves.toBeUndefined();
		const result = await database.query<{ indexdef: string }>(`
			SELECT indexdef FROM pg_indexes
			WHERE indexname = 'messages_thread_history_search_idx'
		`);
		expect(result.rows[0]?.indexdef.toLowerCase()).toContain('"left"(');
		expect(result.rows[0]?.indexdef).toContain("32768");
	});
});
