import { describe, expect, it, vi } from "vitest";
import { clearEmbeddingCache, embedQuery } from "../embedding-cache";
import type { FlowEmbeddingLike } from "../vector-search";

const makeLocal = () => {
	const textToVector = vi.fn(async (text: string) => [text.length, 1, 2]);
	return {
		service: {
			textToVector,
			isReady: () => true,
		} as unknown as FlowEmbeddingLike,
		textToVector,
	};
};

const makeRemote = () => {
	const create = vi.fn(async ({ input }: { input: string }) => ({
		data: [{ embedding: [input.length, 9] }],
	}));
	return {
		service: {
			embeddings: { create },
			textToVector: vi.fn(),
			isReady: () => true,
		} as unknown as FlowEmbeddingLike,
		create,
	};
};

describe("embedQuery", () => {
	it("embeds a repeated query once", async () => {
		const { service, textToVector } = makeLocal();

		// What one smart-retrieve pass does today: the step, then the node search,
		// then the edge search, all on the same text.
		await embedQuery(service, "what changed today");
		await embedQuery(service, "what changed today");
		await embedQuery(service, "what changed today");

		expect(textToVector).toHaveBeenCalledTimes(1);
	});

	it("returns the same vector each time", async () => {
		const { service } = makeLocal();
		const a = await embedQuery(service, "abc");
		const b = await embedQuery(service, "abc");
		expect(b).toEqual(a);
	});

	it("still embeds different queries separately", async () => {
		const { service, textToVector } = makeLocal();
		await embedQuery(service, "one");
		await embedQuery(service, "two");
		expect(textToVector).toHaveBeenCalledTimes(2);
	});

	it("shares one inference between concurrent callers", async () => {
		const { service, textToVector } = makeLocal();
		await Promise.all([
			embedQuery(service, "same"),
			embedQuery(service, "same"),
			embedQuery(service, "same"),
		]);
		expect(textToVector).toHaveBeenCalledTimes(1);
	});

	it("uses the remote provider when there is one, and caches that too", async () => {
		const { service, create } = makeRemote();
		expect(await embedQuery(service, "hi")).toEqual([2, 9]);
		await embedQuery(service, "hi");
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("does not serve one model's vectors to another", async () => {
		// Switching embedding model replaces the service instance, so the cache
		// keyed on that instance is cold — no stale vectors from the old model.
		const first = makeLocal();
		const second = makeLocal();
		await embedQuery(first.service, "shared text");
		await embedQuery(second.service, "shared text");

		expect(first.textToVector).toHaveBeenCalledTimes(1);
		expect(second.textToVector).toHaveBeenCalledTimes(1);
	});

	it("does not remember a failure as the answer", async () => {
		const textToVector = vi
			.fn<(text: string) => Promise<number[]>>()
			.mockRejectedValueOnce(new Error("model not ready"))
			.mockResolvedValueOnce([1, 2, 3]);
		const service = {
			textToVector,
			isReady: () => true,
		} as unknown as FlowEmbeddingLike;

		await expect(embedQuery(service, "q")).rejects.toThrow("model not ready");
		expect(await embedQuery(service, "q")).toEqual([1, 2, 3]);
	});

	it("bounds how many queries it keeps", async () => {
		const { service, textToVector } = makeLocal();
		for (let i = 0; i < 70; i += 1) await embedQuery(service, `q${i}`);
		textToVector.mockClear();

		// The oldest is gone; the newest is still there.
		await embedQuery(service, "q0");
		expect(textToVector).toHaveBeenCalledTimes(1);
		await embedQuery(service, "q69");
		expect(textToVector).toHaveBeenCalledTimes(1);
	});

	it("can be cleared for one service without touching another", async () => {
		const first = makeLocal();
		const second = makeLocal();
		await embedQuery(first.service, "x");
		await embedQuery(second.service, "x");

		clearEmbeddingCache(first.service);
		await embedQuery(first.service, "x");
		await embedQuery(second.service, "x");

		expect(first.textToVector).toHaveBeenCalledTimes(2);
		expect(second.textToVector).toHaveBeenCalledTimes(1);
	});
});
