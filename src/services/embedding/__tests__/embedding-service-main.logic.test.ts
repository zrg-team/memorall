import { beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(
	() =>
		[] as Array<{
			config: unknown;
			initialize: ReturnType<typeof vi.fn>;
			destroy: ReturnType<typeof vi.fn>;
		}>,
);

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));
vi.mock("@/utils/embedding-size-config", () => ({
	getCurrentModelId: vi.fn(async () => "model-a"),
}));
vi.mock("../implementations/local-embedding", () => ({
	LocalEmbedding: vi.fn(),
}));
vi.mock("../implementations/openai-embedding", () => ({
	OpenAIEmbedding: vi.fn(),
}));
vi.mock("../implementations/worker-embedding", () => ({
	WorkerEmbedding: vi.fn(function WorkerEmbedding(config: unknown) {
		const embedding = {
			config,
			initialize: vi.fn(async () => undefined),
			destroy: vi.fn(),
			isReady: () => true,
		};
		created.push(embedding);
		return embedding;
	}),
}));

import { EmbeddingServiceMain } from "../embedding-service-main";

beforeEach(() => {
	created.length = 0;
});

describe("EmbeddingServiceMain.create", () => {
	it("registers without loading when asked to", async () => {
		const service = new EmbeddingServiceMain();
		await service.create(
			"default",
			"worker",
			{ type: "worker", modelName: "model-a" },
			{ initialize: false },
		);

		expect(created[0]!.initialize).not.toHaveBeenCalled();
		expect(service.has("default")).toBe(true);
		expect(service.isReadyByName("default")).toBe(true);
	});

	it("loads by default", async () => {
		const service = new EmbeddingServiceMain();
		await service.create("default", "worker", { modelName: "model-a" });
		expect(created[0]!.initialize).toHaveBeenCalledTimes(1);
	});

	it("destroys the embedding it replaces", async () => {
		const service = new EmbeddingServiceMain();
		await service.create("default", "worker", { modelName: "model-a" });
		await service.create("default", "worker", { modelName: "model-b" });

		expect(created[0]!.destroy).toHaveBeenCalledTimes(1);
		expect(created[1]!.destroy).not.toHaveBeenCalled();
		expect(await service.get("default")).toBe(created[1]);
	});
});
