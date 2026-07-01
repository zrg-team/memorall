import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../embedding-size-config", () => ({
	getCurrentEmbeddingColumns: vi.fn(async () => ({
		nameEmbedding: "name_embedding",
		factEmbedding: "fact_embedding",
		typeEmbedding: "type_embedding",
		embedding: "embedding",
	})),
}));

import {
	combineSearchResults,
	vectorSearchEdges,
	vectorSearchNodes,
} from "../vector-search";
import {
	combineSearchResultsWithTrigram,
	trigramSearchEdges,
	trigramSearchNodes,
} from "../trigram-search";

const makeDatabase = (rows: unknown[]) => {
	const raw = vi.fn(async () => ({ rows }));
	const use = vi.fn(
		async (callback: (helpers: { raw: typeof raw }) => unknown) =>
			callback({ raw }),
	);
	return { raw, service: { use } };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("vector search utilities", () => {
	it("returns empty vector node results for empty search terms", async () => {
		const embedding = { textToVector: vi.fn() };
		const result = await vectorSearchNodes({} as any, embedding as any, [], 5);

		expect(result).toEqual([]);
		expect(embedding.textToVector).not.toHaveBeenCalled();
	});

	it("queries node vectors with the current embedding column and graph filter", async () => {
		const { raw, service } = makeDatabase([
			{
				id: "n1",
				node_type: "Entity",
				name: "Alice",
				summary: "Person",
				attributes: { role: "admin" },
				graph: "work",
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-02T00:00:00.000Z",
				similarity: 0.91,
			},
		]);

		const result = await vectorSearchNodes(
			service as any,
			{ textToVector: vi.fn(async () => [0.1, 0.2]) } as any,
			["Alice", "admin"],
			3,
			"work",
		);

		expect(raw).toHaveBeenCalledWith(
			expect.stringContaining("name_embedding <=> $1::vector"),
			["[0.1,0.2]", "work", 3],
		);
		expect(result).toEqual([
			{
				item: expect.objectContaining({
					id: "n1",
					nodeType: "Entity",
					name: "Alice",
					graph: "work",
				}),
				similarity: 0.91,
			},
		]);
		expect(result[0].item.createdAt).toBeInstanceOf(Date);
	});

	it("queries edge vectors and falls back to empty results on database errors", async () => {
		const { raw, service } = makeDatabase([
			{
				id: "e1",
				source_id: "n1",
				destination_id: "n2",
				edge_type: "knows",
				fact_text: "Alice knows Bob",
				valid_at: "2024-01-01T00:00:00.000Z",
				invalid_at: "2024-02-01T00:00:00.000Z",
				attributes: {},
				graph: "",
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-02T00:00:00.000Z",
				similarity: 0.82,
			},
		]);

		const result = await vectorSearchEdges(
			service as any,
			{ textToVector: vi.fn(async () => [0.3]) } as any,
			["knows"],
			2,
		);

		expect(raw).toHaveBeenCalledWith(expect.stringContaining("GREATEST"), [
			"[0.3]",
			2,
		]);
		expect(result[0]).toEqual({
			item: expect.objectContaining({
				id: "e1",
				sourceId: "n1",
				destinationId: "n2",
				edgeType: "knows",
				factText: "Alice knows Bob",
			}),
			similarity: 0.82,
		});

		await expect(
			vectorSearchEdges(
				{
					use: vi.fn(async () => {
						throw new Error("db");
					}),
				} as any,
				{ textToVector: vi.fn(async () => [0.3]) } as any,
				["knows"],
				2,
			),
		).resolves.toEqual([]);
	});

	it("combines weighted SQL and vector results with SQL priority", () => {
		const sql = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const vector = [
			{ item: { id: "b" }, similarity: 0.9 },
			{ item: { id: "d" }, similarity: 0.8 },
		];

		expect(
			combineSearchResults(
				sql,
				vector,
				{ sqlPercentage: 50, vectorPercentage: 50 },
				4,
				(item) => item.id,
			),
		).toEqual([{ id: "a" }, { id: "b" }, { id: "d" }]);

		expect(
			combineSearchResults(
				[],
				vector,
				{ sqlPercentage: 90, vectorPercentage: 10 },
				1,
				(item) => item.id,
			),
		).toEqual([{ id: "b" }]);
	});
});

describe("trigram search utilities", () => {
	it("returns empty trigram node results for empty or blank terms", async () => {
		await expect(trigramSearchNodes({} as any, [], 5)).resolves.toEqual([]);
		await expect(trigramSearchNodes({} as any, ["   "], 5)).resolves.toEqual(
			[],
		);
	});

	it("queries trigram nodes and maps snake_case rows", async () => {
		const { raw, service } = makeDatabase([
			{
				id: "n1",
				node_type: "Entity",
				name: "Alice",
				summary: "Person",
				attributes: {},
				graph: "work",
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-02T00:00:00.000Z",
				similarity_score: 0.7,
			},
		]);

		const result = await trigramSearchNodes(
			service as any,
			["ALICE"],
			3,
			{ threshold: 0.2 },
			"work",
		);

		expect(raw).toHaveBeenCalledWith(
			expect.stringContaining("WHERE graph = $4"),
			["alice", 0.2, 3, "work"],
		);
		expect(result).toEqual([
			{
				item: expect.objectContaining({ id: "n1", nodeType: "Entity" }),
				score: 0.7,
			},
		]);
	});

	it("queries trigram edges and returns empty results on errors", async () => {
		const { raw, service } = makeDatabase([
			{
				id: "e1",
				source_id: "n1",
				destination_id: "n2",
				edge_type: "likes",
				fact_text: "Alice likes Bob",
				valid_at: "2024-01-01T00:00:00.000Z",
				invalid_at: "2024-02-01T00:00:00.000Z",
				attributes: { confidence: "high" },
				graph: "",
				created_at: "2024-01-01T00:00:00.000Z",
				updated_at: "2024-01-02T00:00:00.000Z",
				similarity_score: 0.6,
			},
		]);

		const result = await trigramSearchEdges(service as any, ["likes"], 2);

		expect(raw).toHaveBeenCalledWith(
			expect.stringContaining("search_edges_trigram($1, $2, $3)"),
			["likes", 0.1, 2],
		);
		expect(result[0]).toEqual({
			item: expect.objectContaining({
				id: "e1",
				sourceId: "n1",
				destinationId: "n2",
				edgeType: "likes",
				factText: "Alice likes Bob",
			}),
			score: 0.6,
		});

		await expect(
			trigramSearchEdges(
				{
					use: vi.fn(async () => {
						throw new Error("db");
					}),
				} as any,
				["likes"],
				2,
			),
		).resolves.toEqual([]);
	});

	it("combines normalized SQL, vector, and trigram results", () => {
		const result = combineSearchResultsWithTrigram(
			[{ id: "sql-1" }, { id: "shared" }],
			[
				{ item: { id: "shared" }, similarity: 0.9 },
				{ item: { id: "vector-1" }, similarity: 0.8 },
			],
			[
				{ item: { id: "trigram-1" }, score: 0.7 },
				{ item: { id: "sql-1" }, score: 0.6 },
			],
			{ sqlPercentage: 50, vectorPercentage: 25, trigramPercentage: 25 },
			4,
			(item) => String(item.id),
		);

		expect(result).toEqual([
			{ id: "sql-1" },
			{ id: "shared" },
			{ id: "trigram-1" },
		]);

		expect(
			combineSearchResultsWithTrigram<{ id: string }>(
				[],
				[],
				[{ item: { id: "only" }, score: 1 }],
				{ sqlPercentage: 80, vectorPercentage: 10, trigramPercentage: 10 },
				2,
				(item) => String(item.id),
			),
		).toEqual([{ id: "only" }]);
	});
});
