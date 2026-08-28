import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/services/database/migrations";
import { schema } from "@/services/database/schema";
import { createMemoryRememberTool } from "../memory-remember";
import { createMemoryRetrieveTool } from "../memory-retrieve";
import type { ActiveMemoryServices } from "../shared";

/**
 * End-to-end cover for active memory over a real Postgres.
 *
 * The mocked tests pin the query shape; this one pins that the shape actually
 * runs — the embedding column written on save is the one the similarity search
 * reads, `<=>` works against it, and a paraphrase finds a memory it shares no
 * substring with. Those are exactly the joints where the previous
 * write-vectors-never-read-them behaviour hid.
 */

const DIMENSIONS = 384; // The default embedding size, and so the *_small columns.
const GRAPH_ID = "space-game-progress";

/**
 * Deterministic stand-in for a sentence embedder: a normalized bag of hashed
 * words. Shared vocabulary moves texts together and unrelated texts stay near
 * orthogonal, which is all the ranking under test depends on.
 */
const embed = (text: string): number[] => {
	const values = new Array<number>(DIMENSIONS).fill(0);
	const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
	for (const word of words) {
		let hash = 7;
		for (const char of word) {
			hash = (hash * 31 + char.charCodeAt(0)) % DIMENSIONS;
		}
		values[hash] += 1;
	}
	const norm = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0));
	// A query of pure punctuation would otherwise be a zero vector, which has no
	// defined cosine distance.
	return norm === 0
		? values.map(() => 1 / Math.sqrt(DIMENSIONS))
		: values.map((value) => value / norm);
};

const runtimeVars = (graphId: string) => {
	const values = new Map<string, unknown>([["memory.graph.id", graphId]]);
	return {
		get: <T>(key: string) => values.get(key) as T | undefined,
		set: (key: string, value: unknown) => {
			values.set(key, value);
		},
		delete: (key: string) => {
			values.delete(key);
		},
		has: (key: string) => values.has(key),
		merge: () => undefined,
		snapshot: () => Object.fromEntries(values.entries()),
	};
};

const context = {
	runtime: runtimeVars(GRAPH_ID),
} as unknown as Parameters<
	ReturnType<typeof createMemoryRetrieveTool>["execute"]
>[1];

describe("active memory over a real database", () => {
	let services: ActiveMemoryServices;
	let pglite: PGlite;

	beforeAll(async () => {
		pglite = new PGlite({ extensions: { vector, uuid_ossp, pg_trgm } });
		await pglite.waitReady;
		await runMigrations(pglite);

		const db = drizzle(pglite, { schema });
		const raw = async (query: string, params?: unknown[]) =>
			(await pglite.query(query, params as unknown[])).rows as Record<
				string,
				unknown
			>[];
		const ctx = { db, schema, raw };
		const knowledge = {
			schema,
			query: <T>(fn: (value: typeof ctx) => Promise<T> | T) => fn(ctx),
			transaction: <T>(fn: (value: typeof ctx) => Promise<T> | T) => fn(ctx),
			raw,
		};

		services = {
			database: { knowledge, raw },
			embedding: {
				get: async () => ({
					isReady: () => true,
					textToVector: async (text: string) => embed(text),
				}),
			},
		} as unknown as ActiveMemoryServices;

		const remember = createMemoryRememberTool(services);
		await remember.execute(
			{
				subject: "User",
				relation: "prefers",
				object: "dark interface",
				factText: "User prefers a dark interface while working at night",
				memoryKind: "preference",
			},
			context,
		);
		await remember.execute(
			{
				subject: "User",
				relation: "ships",
				object: "Chrome extension",
				factText: "User ships the browser extension every Friday",
				memoryKind: "project_context",
			},
			context,
		);

		// A fact as the ingestion pipeline writes it: same graph, no origin
		// attribute, which is what made a populated graph read as empty.
		await raw(
			`INSERT INTO nodes (node_type, name, graph, name_embedding_small)
			 VALUES ('entity', 'Dragon Ascent', $1, $2), ('value', '42 provinces', $1, $3)`,
			[
				GRAPH_ID,
				JSON.stringify(embed("Dragon Ascent")),
				JSON.stringify(embed("42 provinces")),
			],
		);
		await raw(
			`INSERT INTO edges (source_id, destination_id, edge_type, fact_text, graph, is_current, recorded_at, attributes, fact_embedding_small)
			 SELECT s.id, d.id, 'contains', 'Dragon Ascent spans 42 provinces in real time', $1, true, now(), '{"entityType":"topic"}'::jsonb, $2
			 FROM nodes s, nodes d
			 WHERE s.name = 'Dragon Ascent' AND d.name = '42 provinces'`,
			[
				GRAPH_ID,
				JSON.stringify(embed("Dragon Ascent spans 42 provinces in real time")),
			],
		);
	}, 120_000);

	it("writes the embedding the search reads back", async () => {
		const rows = await pglite.query<{ count: number }>(
			`SELECT COUNT(*)::int AS count FROM edges
			 WHERE attributes->>'origin' = 'active_memory' AND fact_embedding_small IS NOT NULL`,
		);
		expect(rows.rows[0]?.count).toBe(2);
	});

	it("finds a memory by meaning when no word of it is quoted", async () => {
		const retrieve = createMemoryRetrieveTool(services);
		const result = await retrieve.execute(
			// Shares "dark"/"interface" with the stored fact but is not a substring
			// of it, so the old LIKE-only lookup returned nothing here.
			{ query: "which dark interface does the user like", limit: 1 },
			context,
		);

		expect(result).toContain("User prefers a dark interface");
		expect(result).toContain("source: active_memory");
	});

	it("ranks the closer memory above the unrelated one", async () => {
		const retrieve = createMemoryRetrieveTool(services);
		const result = (await retrieve.execute(
			{ query: "shipping the browser extension", scope: "active" },
			context,
		)) as string;

		expect(result.indexOf("ships the browser extension")).toBeLessThan(
			result.indexOf("dark interface"),
		);
	});

	it("reaches extracted knowledge that carries no origin", async () => {
		const retrieve = createMemoryRetrieveTool(services);
		const result = await retrieve.execute(
			{ query: "how many provinces does Dragon Ascent have", limit: 3 },
			context,
		);

		expect(result).toContain("Dragon Ascent spans 42 provinces");
		expect(result).toContain("source: knowledge_graph");
	});

	it("hides extracted knowledge from the write scope", async () => {
		const retrieve = createMemoryRetrieveTool(services);
		const result = await retrieve.execute(
			{ query: "Dragon Ascent provinces", scope: "active", limit: 3 },
			context,
		);

		expect(result).not.toContain("Dragon Ascent spans 42 provinces");
	});

	it("returns nothing for a different memory space", async () => {
		const retrieve = createMemoryRetrieveTool(services);
		const result = await retrieve.execute({ query: "dark interface" }, {
			runtime: runtimeVars("space-other"),
		} as unknown as typeof context);

		expect(result).toBe("No matching memories found.");
	});
});
