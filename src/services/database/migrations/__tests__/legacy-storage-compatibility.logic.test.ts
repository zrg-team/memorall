import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createLegacyPGliteFixture,
	legacyStorageIds,
} from "@/test/fixtures/legacy-storage-fixture";
import { migrations, runMigrations } from "../index";

describe("legacy PGlite storage compatibility", () => {
	it("reopens a legacy data directory, migrates it, and preserves every user-data domain", async () => {
		const dataDir = await mkdtemp(join(tmpdir(), "memorall-legacy-pglite-"));
		let legacyDatabase:
			| Awaited<ReturnType<typeof createLegacyPGliteFixture>>
			| undefined = await createLegacyPGliteFixture(dataDir);
		let upgradedDatabase: PGlite | undefined;

		try {
			await legacyDatabase.close();
			legacyDatabase = undefined;

			upgradedDatabase = new PGlite(dataDir, {
				extensions: { vector, uuid_ossp, pg_trgm },
			});
			await upgradedDatabase.waitReady;
			await runMigrations(upgradedDatabase);
			// Opening the same schema again must remain idempotent.
			await runMigrations(upgradedDatabase);

			const document = await upgradedDatabase.query<{
				id: string;
				name: string;
				file_path: string;
				raw: string;
			}>(`
				SELECT s.id, s.name, tf.file_path, s.raw
				FROM sources s
				JOIN topic_files tf ON tf.topic_id = s.target_id::uuid
				WHERE s.id = '${legacyStorageIds.documentSource}'
			`);
			expect(document.rows).toEqual([
				expect.objectContaining({
					id: legacyStorageIds.documentSource,
					name: "legacy-upgrade-note.md",
					file_path: "/documents/legacy-upgrade-note.md",
					raw: "# Legacy upgrade note",
				}),
			]);

			const topic = await upgradedDatabase.query<{
				uuid: string;
				name: string;
				grow_type: string;
				recall_type: string;
			}>(`
				SELECT uuid, name, grow_type, recall_type
				FROM topics WHERE uuid = '${legacyStorageIds.topic}'
			`);
			expect(topic.rows[0]).toEqual(
				expect.objectContaining({
					uuid: legacyStorageIds.topic,
					name: "Legacy research",
					grow_type: "knowledge-graph",
					recall_type: "graph-search",
				}),
			);

			const conversation = await upgradedDatabase.query<{
				conversation_id: string;
				message_id: string;
				content: string;
				parts: Array<{ type: string; text: string }>;
			}>(`
				SELECT c.id AS conversation_id, m.uuid AS message_id,
				       m.content, m.parts
				FROM conversations c
				JOIN messages m ON m.conversation_id = c.id
				WHERE c.id = '${legacyStorageIds.conversation}'
			`);
			expect(conversation.rows[0]).toEqual(
				expect.objectContaining({
					conversation_id: legacyStorageIds.conversation,
					message_id: legacyStorageIds.message,
					content: "Please remember the legacy document",
					parts: [
						{
							type: "text",
							text: "Please remember the legacy document",
						},
					],
				}),
			);

			const graph = await upgradedDatabase.query<{
				id: string;
				source_id: string;
				destination_id: string;
				fact_text: string;
			}>(`
				SELECT id, source_id, destination_id, fact_text
				FROM edges WHERE id = '${legacyStorageIds.graphEdge}'
			`);
			expect(graph.rows[0]).toEqual(
				expect.objectContaining({
					id: legacyStorageIds.graphEdge,
					source_id: legacyStorageIds.graphSourceNode,
					destination_id: legacyStorageIds.graphDestinationNode,
					fact_text: "The legacy note documents storage compatibility",
				}),
			);

			const settings = await upgradedDatabase.query<{
				id: string;
				data: { theme: string; language: string };
			}>(`
				SELECT id, data FROM configurations
				WHERE id = '${legacyStorageIds.configuration}'
			`);
			expect(settings.rows[0]).toEqual({
				id: legacyStorageIds.configuration,
				data: { theme: "dark", language: "en" },
			});

			const cronJob = await upgradedDatabase.query<{
				id: string;
				status: string;
				run_count: number;
				conversation_id: string;
			}>(`
				SELECT id, status, run_count, conversation_id
				FROM cron_jobs WHERE id = '${legacyStorageIds.cronJob}'
			`);
			expect(cronJob.rows[0]).toEqual(
				expect.objectContaining({
					id: legacyStorageIds.cronJob,
					status: "active",
					run_count: 3,
					conversation_id: legacyStorageIds.conversation,
				}),
			);

			const applied = await upgradedDatabase.query<{ id: string }>(`
				SELECT id FROM _migrations ORDER BY version
			`);
			expect(applied.rows.map(({ id }) => id)).toEqual(
				migrations.map(({ id }) => id),
			);

			const searchIndex = await upgradedDatabase.query<{ count: number }>(`
				SELECT count(*)::int AS count FROM pg_indexes
				WHERE indexname = 'messages_thread_history_search_idx'
			`);
			expect(searchIndex.rows[0]?.count).toBe(1);
		} finally {
			await legacyDatabase?.close();
			await upgradedDatabase?.close();
			await rm(dataDir, { force: true, recursive: true });
		}
	}, 60_000);
});
