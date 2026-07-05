/**
 * Full-flow tests for dynamic embedding dimensions.
 *
 * These guard the regression that caused "expected 768 dimensions, not 384":
 * a 384-dim (Small) vector must land in the `name_embedding_small` (384d) column
 * — never the 768d `name_embedding` column — and recall must read back from the
 * same size-specific column. The flow is exercised end to end for every size:
 *
 *   config mapping  ->  grow/write (database-save step)  ->  recall (vector search)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock shared storage so the embedding size is controllable in-test --------
const { storage, sharedStorageService } = vi.hoisted(() => {
	const storage = new Map<string, unknown>();
	const sharedStorageService = {
		get: vi.fn(async (key: string) => storage.get(key) ?? null),
		set: vi.fn(async (key: string, value: unknown) => {
			storage.set(key, value);
		}),
	};
	return { storage, sharedStorageService };
});

vi.mock("@/services/shared-storage/shared-storage-service", () => ({
	sharedStorageService,
}));

import { getDimensions, type EmbeddingSize } from "@/config/embedding-models";
import { node, edge, source, sourceNode, sourceEdge } from "@/services/database/entities";

import {
	getCurrentEmbeddingColumns,
	getCurrentEmbeddingFields,
} from "../utils/embedding-size-config";
import { createDatabaseSaveStep } from "../steps/features/knowledge-grow/database-save";
import {
	vectorSearchEdges,
	vectorSearchNodes,
} from "../utils/vector-search";

const SIZES: EmbeddingSize[] = ["small", "medium", "large"];

/** Field/column names each size is expected to route embeddings through. */
const EXPECTED = {
	small: {
		nameField: "nameEmbeddingSmall",
		otherFields: ["nameEmbedding", "nameEmbeddingLarge"],
		nameColumn: "name_embedding_small",
		factColumn: "fact_embedding_small",
		typeColumn: "type_embedding_small",
	},
	medium: {
		nameField: "nameEmbedding",
		otherFields: ["nameEmbeddingSmall", "nameEmbeddingLarge"],
		nameColumn: "name_embedding",
		factColumn: "fact_embedding",
		typeColumn: "type_embedding",
	},
	large: {
		nameField: "nameEmbeddingLarge",
		otherFields: ["nameEmbeddingSmall", "nameEmbedding"],
		nameColumn: "name_embedding_large",
		factColumn: "fact_embedding_large",
		typeColumn: "type_embedding_large",
	},
} as const;

function setSize(size: EmbeddingSize) {
	storage.set("embeddingSize", size);
}

/** Embedding service producing a vector whose length matches the size. */
function makeEmbeddingService(dim: number) {
	const vector = Array.from({ length: dim }, (_, i) => (i + 1) / dim);
	const model = {
		isReady: () => true,
		textToVector: async () => vector,
		textsToVectors: async (texts: string[]) => texts.map(() => vector),
	};
	return {
		...model,
		get: async () => model,
	};
}

/**
 * Mock knowledge database that captures every inserted row per table and
 * answers the source lookup. No real SQL runs — we assert on captured values.
 */
function makeWriteDatabase(sourceId: string) {
	const inserts: Record<string, Record<string, unknown>[]> = {};
	let idCounter = 0;

	const tableName = (table: unknown): string => {
		if (table === node) return "nodes";
		if (table === edge) return "edges";
		if (table === source) return "sources";
		if (table === sourceNode) return "sourceNodes";
		if (table === sourceEdge) return "sourceEdges";
		return "unknown";
	};

	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: sourceId }],
				}),
			}),
		}),
		insert: (table: unknown) => ({
			values: (values: Record<string, unknown>) => {
				const name = tableName(table);
				(inserts[name] ??= []).push(values);
				const rows = [{ id: `${name}-${idCounter++}`, ...values }];
				// `.values()` is awaited directly for join tables and chained with
				// `.returning()` for nodes/edges — support both shapes.
				const result = Promise.resolve(rows) as unknown as Promise<
					Record<string, unknown>[]
				> & { returning: () => Promise<Record<string, unknown>[]> };
				result.returning = async () => rows;
				return result;
			},
		}),
	};

	const knowledge = {
		schema: { nodes: node, edges: edge, sources: source },
		query: async <T>(
			fn: (ctx: {
				db: typeof db;
				schema: Record<string, unknown>;
				raw: () => Promise<never[]>;
			}) => Promise<T>,
		): Promise<T> =>
			fn({
				db,
				schema: {
					nodes: node,
					edges: edge,
					sources: source,
					sourceNodes: sourceNode,
					sourceEdges: sourceEdge,
				},
				raw: async () => [],
			}),
	};

	return { database: { knowledge }, inserts };
}

beforeEach(() => {
	storage.clear();
	vi.clearAllMocks();
});

describe("dynamic embedding dimension — config mapping", () => {
	it.each(SIZES)("maps fields and columns for %s size", async (size) => {
		setSize(size);
		const exp = EXPECTED[size];

		const fields = await getCurrentEmbeddingFields();
		expect(fields.nameEmbedding).toBe(exp.nameField);

		const columns = await getCurrentEmbeddingColumns();
		expect(columns.nameEmbedding).toBe(exp.nameColumn);
		expect(columns.factEmbedding).toBe(exp.factColumn);
		expect(columns.typeEmbedding).toBe(exp.typeColumn);
	});
});

describe("dynamic embedding dimension — grow/write flow", () => {
	it.each(SIZES)(
		"writes a %s node embedding into the size-specific column",
		async (size) => {
			setSize(size);
			const dim = getDimensions(size);
			const exp = EXPECTED[size];
			const sourceId = "11111111-1111-4111-8111-111111111111";

			const { database, inserts } = makeWriteDatabase(sourceId);
			const step = createDatabaseSaveStep({
				database: database as never,
				embedding: makeEmbeddingService(dim) as never,
			});

			const result = await step.execute({
				sourceId,
				graphId: "",
				title: "Test",
				resolvedEntities: [
					{
						uuid: "entity-1",
						finalName: "LingxiDiagBench",
						nodeType: "BENCHMARK",
						summary: "A benchmark",
						attributes: {},
						isExisting: false,
					},
				],
				resolvedFacts: [],
			});

			// The step swallows per-entity errors, so prove the insert happened.
			expect(result.output.errors).toBeUndefined();
			expect(inserts.nodes).toHaveLength(1);

			const inserted = inserts.nodes[0];
			// Embedding lands under the size-specific field, with the right length…
			expect(inserted[exp.nameField]).toHaveLength(dim);
			// …and never under any other size's field (the original bug).
			for (const other of exp.otherFields) {
				expect(inserted[other]).toBeUndefined();
			}
		},
	);
});

describe("dynamic embedding dimension — recall/retrieval flow", () => {
	it.each(SIZES)(
		"vector-searches %s nodes against the size-specific column",
		async (size) => {
			setSize(size);
			const dim = getDimensions(size);
			const exp = EXPECTED[size];

			const raw = vi.fn(async () => ({ rows: [] }));
			const db = { raw } as never;
			const emb = makeEmbeddingService(dim) as never;

			await vectorSearchNodes(db, emb, ["query text"], 5);

			expect(raw).toHaveBeenCalledTimes(1);
			const [query, params] = raw.mock.calls[0] as unknown as [
				string,
				unknown[],
			];
			expect(query).toContain(`${exp.nameColumn} <=>`);
			expect(query).toContain(`${exp.nameColumn} IS NOT NULL`);
			// The query vector matches the current size's dimension.
			expect(JSON.parse(params[0] as string)).toHaveLength(dim);
		},
	);

	it.each(SIZES)(
		"vector-searches %s edges against the size-specific columns",
		async (size) => {
			setSize(size);
			const dim = getDimensions(size);
			const exp = EXPECTED[size];

			const raw = vi.fn(async () => ({ rows: [] }));
			const db = { raw } as never;
			const emb = makeEmbeddingService(dim) as never;

			await vectorSearchEdges(db, emb, ["query text"], 5);

			expect(raw).toHaveBeenCalledTimes(1);
			const [query] = raw.mock.calls[0] as unknown as [string, unknown[]];
			expect(query).toContain(`${exp.factColumn} <=>`);
			expect(query).toContain(`${exp.typeColumn} <=>`);
		},
	);
});
