import { describe, expect, it, vi } from "vitest";

import { EmbeddingServiceCore } from "../embedding/embedding-service-core";
import {
	canUseEmbeddingSize,
	getLocalEmbeddingConfig,
	getModelNameForSize,
	getOpenAIEmbeddingConfig,
	getWorkerEmbeddingConfig,
} from "../embedding/embedding-model-helper";
import { cosineSimilarity, findMostSimilar } from "../embedding";
import type { BaseEmbedding } from "../embedding/interfaces/base-embedding";

const makeEmbedding = (
	name: string,
	vector: number[] = [1, 2, 3],
): BaseEmbedding & { destroy: ReturnType<typeof vi.fn> } => ({
	name,
	dimensions: vector.length,
	initialize: vi.fn(async () => undefined),
	isReady: vi.fn(() => true),
	textToVector: vi.fn(async () => vector),
	textsToVectors: vi.fn(async (texts: string[]) =>
		texts.map((_, index) => vector.map((value) => value + index)),
	),
	getInfo: vi.fn(() => ({
		name,
		type: "local" as const,
		dimensions: vector.length,
	})),
	destroy: vi.fn(),
});

class TestEmbeddingService extends EmbeddingServiceCore {
	constructor(private readonly defaultEmbedding = makeEmbedding("default")) {
		super();
	}

	async create(name: string): Promise<BaseEmbedding> {
		this.embeddings.set(
			name,
			name === "default" ? this.defaultEmbedding : makeEmbedding(name),
		);
		return this.embeddings.get(name)!;
	}

	async get(name: string): Promise<BaseEmbedding | null | undefined> {
		return this.embeddings.get(name) ?? null;
	}

	protected async createDefaultEmbedding(): Promise<void> {
		await this.create("default");
	}
}

describe("embedding vector utilities", () => {
	it("computes cosine similarity and validates dimensions", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
		expect(() => cosineSimilarity([1], [1, 2])).toThrow(
			"Vectors must have the same dimension",
		);
	});

	it("finds the most similar vectors in descending order", () => {
		expect(
			findMostSimilar(
				[1, 0],
				[
					[0, 1],
					[1, 0],
					[0.5, 0.5],
				],
				2,
			),
		).toEqual([
			{ index: 1, similarity: 1 },
			{ index: 2, similarity: expect.closeTo(0.7071, 4) },
		]);
	});
});

describe("embedding model helper", () => {
	it("builds local, worker, and OpenAI configs by embedding size", () => {
		expect(getLocalEmbeddingConfig("small")).toEqual({
			type: "local",
			modelName: "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
		});
		expect(getWorkerEmbeddingConfig("medium")).toEqual({
			type: "worker",
			modelName: "nomic-ai/nomic-embed-text-v1.5",
		});
		expect(getOpenAIEmbeddingConfig("large", "key", "url")).toEqual({
			type: "openai",
			modelName: "text-embedding-3-small",
			apiKey: "key",
			baseUrl: "url",
		});
		expect(getModelNameForSize("small", "worker")).toBe(
			"Xenova/paraphrase-multilingual-MiniLM-L12-v2",
		);
		expect(getModelNameForSize("large", "openai")).toBe(
			"text-embedding-3-small",
		);
	});

	it("rejects remote-only sizes for local and worker embedding types", () => {
		expect(canUseEmbeddingSize("large", "openai")).toBe(true);
		expect(canUseEmbeddingSize("large", "local")).toBe(false);
		expect(canUseEmbeddingSize("small", "worker")).toBe(true);
		expect(() => getLocalEmbeddingConfig("large")).toThrow(
			"requires remote API and cannot be used with LocalEmbedding",
		);
		expect(() => getWorkerEmbeddingConfig("large")).toThrow(
			"requires remote API and cannot be used with WorkerEmbedding",
		);
		expect(() => getModelNameForSize("large", "local")).toThrow(
			"requires remote API for local",
		);
	});
});

describe("EmbeddingServiceCore", () => {
	it("tracks named embeddings and delegates vector operations", async () => {
		const defaultEmbedding = makeEmbedding("default", [4, 5]);
		const service = new TestEmbeddingService(defaultEmbedding);

		expect(service.isReady()).toBe(false);
		await service.create("default");

		expect(service.has("default")).toBe(true);
		expect(service.list()).toEqual(["default"]);
		expect(service.getInfo()).toEqual({
			name: "default",
			type: "embedding",
			ready: true,
		});
		expect(service.getInfoFor("default")).toEqual({
			name: "default",
			type: "local",
			ready: true,
		});
		await expect(service.textToVector("hello")).resolves.toEqual([4, 5]);
		await expect(service.textsToVectors(["a", "b"])).resolves.toEqual([
			[4, 5],
			[5, 6],
		]);
		expect(defaultEmbedding.textToVector).toHaveBeenCalledWith("hello");
	});

	it("removes and clears embeddings while destroying implementations", async () => {
		const defaultEmbedding = makeEmbedding("default");
		const service = new TestEmbeddingService(defaultEmbedding);
		await service.create("default");

		expect(service.remove("missing")).toBe(false);
		expect(service.remove("default")).toBe(true);
		expect(defaultEmbedding.destroy).toHaveBeenCalledTimes(1);
		expect(service.isReady()).toBe(false);

		await service.create("default");
		service.clear();
		expect(defaultEmbedding.destroy).toHaveBeenCalledTimes(2);
		expect(service.list()).toEqual([]);
	});

	it("throws when callers request an unknown embedding", async () => {
		const service = new TestEmbeddingService();

		expect(() => service.getInfoFor("missing")).toThrow(
			'Embedding "missing" not found',
		);
		await expect(service.textToVectorFor("missing", "text")).rejects.toThrow(
			'Embedding "missing" not found',
		);
	});
});
