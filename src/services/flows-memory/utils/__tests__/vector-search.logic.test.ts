import { describe, expect, it, vi } from "vitest";
import {
	searchEdgesByVector,
	searchNodesByVector,
	vectorSearchNodes,
} from "../vector-search";
import type { FlowEmbeddingLike } from "../vector-search";
import type { IFlowDatabase } from "../../interfaces/database";

const fakeDb = () => {
	const raw = vi.fn(async () => ({ rows: [] }));
	return { db: { raw } as unknown as IFlowDatabase, raw };
};

const fakeEmbedding = () => {
	const textToVector = vi.fn(async () => [0.1, 0.2, 0.3]);
	return {
		emb: { textToVector, isReady: () => true } as unknown as FlowEmbeddingLike,
		textToVector,
	};
};

describe("vector search by vector", () => {
	it("needs no embedding service at all", async () => {
		// The signature is the fix: a caller holding the query vector cannot
		// accidentally trigger a second inference, because there is nothing here
		// to embed with.
		const { db, raw } = fakeDb();
		await searchNodesByVector(db, [0.1, 0.2, 0.3], 5);
		expect(raw).toHaveBeenCalledTimes(1);
	});

	it("passes the caller's vector to the query", async () => {
		const { db, raw } = fakeDb();
		await searchNodesByVector(db, [1, 2, 3], 5);
		const [, params] = raw.mock.calls[0] as unknown as [string, unknown[]];
		expect(params[0]).toBe(JSON.stringify([1, 2, 3]));
	});

	it("scopes to a graph when given one, and to ungrouped rows when not", async () => {
		const { db, raw } = fakeDb();
		await searchNodesByVector(db, [1], 5, "graph-a");
		const [scoped] = raw.mock.calls[0] as unknown as [string];
		expect(scoped).toContain("graph = $2");

		await searchEdgesByVector(db, [1], 5);
		const [unscoped] = raw.mock.calls[1] as unknown as [string];
		expect(unscoped).toContain("graph = '' OR graph IS NULL");
	});

	it("returns nothing rather than throwing when the query fails", async () => {
		const db = {
			raw: vi.fn(async () => {
				throw new Error("relation does not exist");
			}),
		} as unknown as IFlowDatabase;

		await expect(searchNodesByVector(db, [1], 5)).resolves.toEqual([]);
	});
});

describe("vector search by text", () => {
	it("still embeds once and delegates, for callers without a vector", async () => {
		const { db, raw } = fakeDb();
		const { emb, textToVector } = fakeEmbedding();

		await vectorSearchNodes(db, emb, ["a gap component"], 5);

		expect(textToVector).toHaveBeenCalledTimes(1);
		expect(raw).toHaveBeenCalledTimes(1);
	});

	it("does not touch the database for an empty term list", async () => {
		const { db, raw } = fakeDb();
		const { emb, textToVector } = fakeEmbedding();

		expect(await vectorSearchNodes(db, emb, [], 5)).toEqual([]);
		expect(textToVector).not.toHaveBeenCalled();
		expect(raw).not.toHaveBeenCalled();
	});
});
