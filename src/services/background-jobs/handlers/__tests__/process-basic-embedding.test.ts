import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseJob, ProcessDependencies } from "../types";

const { embeddingService, serviceManager, embeddingConfig } = vi.hoisted(() => {
	const embedding = {
		name: "default",
		dimensions: 3,
		initialize: vi.fn(async () => undefined),
		isReady: vi.fn(() => true),
		textToVector: vi.fn(async () => [1, 2, 3]),
		textsToVectors: vi.fn(async () => [
			[1, 2, 3],
			[4, 5, 6],
		]),
		getInfo: vi.fn(() => ({ name: "default", type: "worker" })),
	};
	const embeddingService = {
		textToVector: vi.fn(async () => [1, 2, 3]),
		textToVectorFor: vi.fn(async () => [7, 8, 9]),
		textsToVectors: vi.fn(async () => [
			[1, 2],
			[3, 4],
		]),
		textsToVectorsFor: vi.fn(async () => [[9, 9]]),
		get: vi.fn(async (name: string) => (name === "missing" ? null : embedding)),
		create: vi.fn(async () => embedding),
		initialize: vi.fn(async () => undefined),
		isReady: vi.fn(() => true),
		list: vi.fn(() => ["default"]),
	};
	const serviceManager = {
		getEmbeddingService: vi.fn(() => embeddingService),
	};
	return {
		embedding,
		embeddingService,
		serviceManager,
		embeddingConfig: {
			setCurrentEmbeddingSize: vi.fn(async () => undefined),
			getCurrentEmbeddingInfo: vi.fn(async () => ({
				size: "small",
				modelId: "local-model",
				dimensions: 384,
			})),
		},
	};
});

vi.mock("@/services", () => ({ serviceManager }));
vi.mock("@/utils/embedding-size-config", () => embeddingConfig);

import { BasicHandler } from "../process-basic";
import { EmbeddingOperationsHandler } from "../process-embedding-operations";

const deps = (): ProcessDependencies => ({
	logger: {
		info: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
		debug: vi.fn(async () => undefined),
	},
	updateJobProgress: vi.fn(async () => undefined),
	completeJob: vi.fn(async () => undefined),
});

const job = (jobType: string, payload: Record<string, unknown> = {}): BaseJob =>
	({
		id: `${jobType}-id`,
		jobType,
		status: "pending",
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		progress: [],
		payload,
	}) as BaseJob;

beforeEach(() => {
	vi.clearAllMocks();
	serviceManager.getEmbeddingService.mockReturnValue(embeddingService);
	embeddingService.isReady.mockReturnValue(true);
	embeddingService.get.mockImplementation(async (name: string) =>
		name === "missing"
			? null
			: {
					name,
					dimensions: 3,
					initialize: vi.fn(async () => undefined),
					isReady: vi.fn(() => true),
					textToVector: vi.fn(async () => [1, 2, 3]),
					textsToVectors: vi.fn(async () => [[1, 2, 3]]),
					getInfo: vi.fn(() => ({ name, type: "worker" })),
				},
	);
});

describe("BasicHandler", () => {
	it("handles async jobs with payload defaults", async () => {
		const result = await new BasicHandler().process(
			"job-1",
			job("basic-async", { message: "hello" }),
			deps(),
		);

		expect(result).toEqual({
			result: "async test completed",
			message: "hello",
			delay: 0,
		});
	});

	it("handles stream jobs and emits per-step progress", async () => {
		const dependencies = deps();

		const result = await new BasicHandler().process(
			"job-2",
			job("basic-stream", { steps: 2, interval: 0 }),
			dependencies,
		);

		expect(dependencies.updateJobProgress).toHaveBeenCalledTimes(2);
		expect(dependencies.updateJobProgress).toHaveBeenCalledWith(
			"job-2",
			expect.objectContaining({ stage: "Step 1 of 2", progress: 0 }),
		);
		expect(result).toEqual({
			result: "stream test completed",
			steps: 2,
			interval: 1000,
			duration: "2000ms",
		});
	});

	it("rejects unknown basic job types", async () => {
		await expect(
			new BasicHandler().process("job-3", job("basic-missing"), deps()),
		).rejects.toThrow("Unknown embedding job type: basic-missing");
	});
});

describe("EmbeddingOperationsHandler", () => {
	it("converts single text with default and named embeddings", async () => {
		const handler = new EmbeddingOperationsHandler();

		await expect(
			handler.process(
				"job-1",
				job("text-to-vector", { text: "hello" }),
				deps(),
			),
		).resolves.toEqual({ vector: [1, 2, 3] });
		expect(embeddingService.textToVector).toHaveBeenCalledWith("hello");

		await expect(
			handler.process(
				"job-2",
				job("text-to-vector", { text: "hello", embeddingName: "named" }),
				deps(),
			),
		).resolves.toEqual({ vector: [7, 8, 9] });
		expect(embeddingService.textToVectorFor).toHaveBeenCalledWith(
			"named",
			"hello",
		);
	});

	it("converts batches of texts", async () => {
		const handler = new EmbeddingOperationsHandler();

		await expect(
			handler.process(
				"job-3",
				job("texts-to-vectors", { texts: ["a", "b"] }),
				deps(),
			),
		).resolves.toEqual({
			vectors: [
				[1, 2],
				[3, 4],
			],
		});

		await expect(
			handler.process(
				"job-4",
				job("texts-to-vectors", { texts: ["a"], embeddingName: "named" }),
				deps(),
			),
		).resolves.toEqual({ vectors: [[9, 9]] });
	});

	it("creates embeddings or returns existing embeddings", async () => {
		const handler = new EmbeddingOperationsHandler();

		await expect(
			handler.process(
				"job-5",
				job("create-embedding", {
					name: "default",
					embeddingType: "worker",
					config: { type: "worker" },
				}),
				deps(),
			),
		).resolves.toEqual({
			embeddingInfo: {
				name: "default",
				type: "worker",
				ready: true,
				dimensions: 3,
				alreadyExisted: true,
			},
		});

		embeddingService.get.mockResolvedValueOnce(null).mockResolvedValueOnce({
			name: "new",
			dimensions: 3,
			initialize: vi.fn(async () => undefined),
			isReady: vi.fn(() => true),
			textToVector: vi.fn(async () => [1, 2, 3]),
			textsToVectors: vi.fn(async () => [[1, 2, 3]]),
			getInfo: vi.fn(() => ({ name: "new", type: "local" })),
		});
		await handler.process(
			"job-6",
			job("create-embedding", {
				name: "new",
				embeddingType: "local",
				config: { type: "local" },
			}),
			deps(),
		);
		expect(embeddingService.create).toHaveBeenCalledWith("new", "local", {
			type: "local",
		});
	});

	it("gets embedding info for existing and missing embeddings", async () => {
		const handler = new EmbeddingOperationsHandler();

		await expect(
			handler.process(
				"job-7",
				job("get-embedding", { name: "default" }),
				deps(),
			),
		).resolves.toEqual({
			embeddingInfo: {
				name: "default",
				type: "worker",
				ready: true,
				dimensions: 3,
				exists: true,
			},
		});

		await expect(
			handler.process(
				"job-8",
				job("get-embedding", { name: "missing" }),
				deps(),
			),
		).resolves.toEqual({
			embeddingInfo: { name: "missing", exists: false, ready: false },
		});
	});

	it("initializes and reloads embedding service", async () => {
		const handler = new EmbeddingOperationsHandler();

		await expect(
			handler.process("job-9", job("initialize-embedding-service"), deps()),
		).resolves.toEqual({
			initialized: true,
			ready: true,
			availableEmbeddings: ["default"],
			wasAlreadyReady: true,
		});

		embeddingService.isReady
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true);
		await handler.process(
			"job-10",
			job("initialize-embedding-service"),
			deps(),
		);
		expect(embeddingService.initialize).toHaveBeenCalled();

		await expect(
			handler.process(
				"job-11",
				job("reload-embedding-model", { newSize: "small" }),
				deps(),
			),
		).resolves.toEqual({
			success: true,
			newSize: "small",
			modelId: "local-model",
			dimensions: 384,
		});
		expect(embeddingConfig.setCurrentEmbeddingSize).toHaveBeenCalledWith(
			"small",
		);
		expect(embeddingService.create).toHaveBeenCalledWith("default", "local", {
			type: "local",
			modelName: "local-model",
		});
	});

	it("rejects unavailable services, remote reloads, and unknown job types", async () => {
		const handler = new EmbeddingOperationsHandler();
		serviceManager.getEmbeddingService.mockReturnValueOnce(null as any);

		await expect(
			handler.process("job-12", job("text-to-vector", { text: "x" }), deps()),
		).rejects.toThrow("Embedding service not available");

		embeddingConfig.getCurrentEmbeddingInfo.mockResolvedValueOnce({
			size: "large",
			modelId: null,
			dimensions: 1536,
		} as any);
		await expect(
			handler.process(
				"job-13",
				job("reload-embedding-model", { newSize: "large" }),
				deps(),
			),
		).rejects.toThrow('Embedding size "large" requires remote API');

		await expect(
			handler.process("job-14", job("embedding-missing"), deps()),
		).rejects.toThrow("Unknown embedding job type: embedding-missing");
	});
});
