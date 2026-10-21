import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	clearDamagedUsageFields,
	inspectUsageStorage,
	isUsageStorageCorruption,
	rebuildUsageStorageIndex,
	type RecoveryQuery,
} from "../usage-storage-recovery";

describe("usage storage recovery with real missing TOAST chunks", () => {
	let pg: PGlite;
	let toast: string;
	let failure: unknown;
	const query: RecoveryQuery = (sql, params) => pg.query(sql, params);
	const bad = "00000000-0000-0000-0000-000000000001";
	const good = "00000000-0000-0000-0000-000000000002";

	beforeAll(async () => {
		pg = new PGlite();
		await pg.waitReady;
		await pg.exec(`
			CREATE TABLE messages (uuid uuid PRIMARY KEY, content text, metadata jsonb, parts jsonb);
			ALTER TABLE messages ALTER COLUMN metadata SET STORAGE EXTERNAL;
			ALTER TABLE messages ALTER COLUMN parts SET STORAGE EXTERNAL;
		`);
		await pg.query(
			"INSERT INTO messages VALUES ($1, 'keep this reply', $2, $3)",
			[
				bad,
				{ usage: { cost: 1 }, padding: "x".repeat(20_000) },
				[{ role: "tool", content: "y".repeat(20_000) }],
			],
		);
		await pg.query(
			"INSERT INTO messages VALUES ($1, 'healthy reply', $2, '[]')",
			[good, { usage: { cost: 2 } }],
		);
		const result = await pg.query<{ name: string }>(
			"SELECT reltoastrelid::regclass::text AS name FROM pg_class WHERE oid = 'messages'::regclass",
		);
		toast = result.rows[0].name;
		// Test-only physical corruption, in an isolated in-memory database.
		// PostgreSQL blocks direct DELETE on TOAST relations. Temporarily mark
		// this test-only relation ordinary, remove its chunks, then restore it.
		await pg.query(
			"UPDATE pg_class SET relkind = 'r' WHERE oid = $1::regclass",
			[toast],
		);
		try {
			await pg.exec(`TRUNCATE ${toast}`);
		} finally {
			await pg.query(
				"UPDATE pg_class SET relkind = 't' WHERE oid = $1::regclass",
				[toast],
			);
		}
		try {
			await pg.query("SELECT metadata, parts FROM messages WHERE uuid = $1", [
				bad,
			]);
		} catch (error) {
			failure = error;
		}
	}, 30_000);

	afterAll(async () => {
		await pg.close();
	});

	it("identifies wrapped PostgreSQL errors without treating other errors as corruption", () => {
		expect(isUsageStorageCorruption(failure)).toBe(true);
		expect(isUsageStorageCorruption(new Error("SQL", { cause: failure }))).toBe(
			true,
		);
		expect(isUsageStorageCorruption(new Error("RPC request timed out"))).toBe(
			false,
		);
	});

	it("rebuilds the toast index without pretending missing physical data was restored", async () => {
		await rebuildUsageStorageIndex(query, failure);
		await expect(
			pg.query("SELECT metadata FROM messages WHERE uuid = $1", [bad]),
		).rejects.toThrow(/missing chunk number/);
	});

	it("locates only unreadable fields and clears them while preserving both replies", async () => {
		const damaged = await inspectUsageStorage(query, failure);
		expect(
			damaged.map(({ table, id, column }) => ({ table, id, column })),
		).toEqual([
			{ table: "messages", id: bad, column: "metadata" },
			{ table: "messages", id: bad, column: "parts" },
		]);
		await expect(clearDamagedUsageFields(query, damaged)).resolves.toBe(2);
		const { rows } = await pg.query(
			"SELECT uuid, content, metadata, parts FROM messages ORDER BY uuid",
		);
		expect(rows).toEqual([
			{ uuid: bad, content: "keep this reply", metadata: {}, parts: null },
			{
				uuid: good,
				content: "healthy reply",
				metadata: { usage: { cost: 2 } },
				parts: [],
			},
		]);
		await expect(inspectUsageStorage(query, failure)).resolves.toEqual([]);
		await expect(clearDamagedUsageFields(query, damaged)).resolves.toBe(0);
	});

	it("rejects arbitrary identifiers and ordinary query failures", async () => {
		await expect(
			clearDamagedUsageFields(query, [
				{
					table: "messages",
					id: bad,
					column: 'metadata" = NULL; --',
					error: String(failure),
				},
			]),
		).rejects.toThrow("Unsupported recovery field");
		await expect(
			inspectUsageStorage(query, "connection closed"),
		).rejects.toThrow("not a supported TOAST chunk error");
		const unavailable: RecoveryQuery = async () => {
			throw new Error("connection closed");
		};
		await expect(inspectUsageStorage(unavailable, failure)).rejects.toThrow(
			"connection closed",
		);
	});

	it("skips a row changed between its corruption probe and the reset", async () => {
		await pg.query("UPDATE messages SET metadata = $1 WHERE uuid = $2", [
			{ padding: "z".repeat(20_000) },
			bad,
		]);
		await pg.query(
			"UPDATE pg_class SET relkind = 'r' WHERE oid = $1::regclass",
			[toast],
		);
		try {
			await pg.exec(`TRUNCATE ${toast}`);
		} finally {
			await pg.query(
				"UPDATE pg_class SET relkind = 't' WHERE oid = $1::regclass",
				[toast],
			);
		}
		const damaged = await inspectUsageStorage(query, failure);
		expect(damaged).toHaveLength(1);
		const racing: RecoveryQuery = async (sql, params) => {
			if (sql.startsWith('UPDATE public."messages"')) {
				await pg.query("UPDATE messages SET metadata = $1 WHERE uuid = $2", [
					{ usage: { cost: 99 } },
					bad,
				]);
			}
			return query(sql, params);
		};
		await expect(clearDamagedUsageFields(racing, damaged)).resolves.toBe(0);
		expect(
			(await pg.query("SELECT metadata FROM messages WHERE uuid = $1", [bad]))
				.rows,
		).toEqual([{ metadata: { usage: { cost: 99 } } }]);
	});
});

describe("usage storage recovery with out-of-sequence TOAST chunks", () => {
	let pg: PGlite;
	let failure: unknown;
	const query: RecoveryQuery = (sql, params) => pg.query(sql, params);
	const bad = "00000000-0000-0000-0000-000000000003";
	const good = "00000000-0000-0000-0000-000000000004";

	beforeAll(async () => {
		pg = new PGlite();
		await pg.waitReady;
		await pg.exec(`
			CREATE TABLE messages (uuid uuid PRIMARY KEY, content text, metadata jsonb, parts jsonb);
			ALTER TABLE messages ALTER COLUMN metadata SET STORAGE EXTERNAL;
		`);
		await pg.query("INSERT INTO messages VALUES ($1, 'keep reply', $2, '[]')", [
			bad,
			{ usage: { cost: 1 }, padding: "x".repeat(20_000) },
		]);
		await pg.query(
			"INSERT INTO messages VALUES ($1, 'healthy reply', $2, '[]')",
			[good, { usage: { cost: 2 } }],
		);
		const { rows } = await pg.query<{ name: string }>(
			"SELECT reltoastrelid::regclass::text AS name FROM pg_class WHERE oid = 'messages'::regclass",
		);
		const toast = rows[0].name;
		// Isolated in-memory fixture only: leave later chunks present, matching
		// the error that used to abort the screenshot's recovery scan.
		await pg.query(
			"UPDATE pg_class SET relkind = 'r' WHERE oid = $1::regclass",
			[toast],
		);
		try {
			await pg.exec(`DELETE FROM ${toast} WHERE chunk_seq = 0`);
		} finally {
			await pg.query(
				"UPDATE pg_class SET relkind = 't' WHERE oid = $1::regclass",
				[toast],
			);
		}
		try {
			await pg.query("SELECT metadata FROM messages WHERE uuid = $1", [bad]);
		} catch (error) {
			failure = error;
		}
	}, 30_000);

	afterAll(async () => {
		await pg.close();
	});

	it("recognizes the unexpected-chunk error and keeps index rebuild lossless", async () => {
		expect(String(failure)).toMatch(/unexpected chunk number 1 \(expected 0\)/);
		expect(
			isUsageStorageCorruption(new Error("query failed", { cause: failure })),
		).toBe(true);
		await rebuildUsageStorageIndex(query, failure);
		await expect(
			pg.query("SELECT metadata FROM messages WHERE uuid = $1", [bad]),
		).rejects.toThrow(/unexpected chunk number/);
	});

	it("continues inspection when a missing-chunk report leads to an unexpected chunk", async () => {
		const originalError = String(failure).replace(
			/unexpected chunk number 1 \(expected 0\)/,
			"missing chunk number 0",
		);
		const damaged = await inspectUsageStorage(query, originalError);
		expect(damaged).toEqual([
			{
				table: "messages",
				id: bad,
				column: "metadata",
				error: expect.stringContaining("unexpected chunk number"),
			},
		]);
		await expect(clearDamagedUsageFields(query, damaged)).resolves.toBe(1);
		expect(
			(
				await pg.query(
					"SELECT content, metadata, parts FROM messages ORDER BY uuid",
				)
			).rows,
		).toEqual([
			{ content: "keep reply", metadata: {}, parts: [] },
			{ content: "healthy reply", metadata: { usage: { cost: 2 } }, parts: [] },
		]);
	});
});
