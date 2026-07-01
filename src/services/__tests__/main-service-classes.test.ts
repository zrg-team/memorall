import { describe, expect, it, vi } from "vitest";
import { DatabaseMode } from "@/services/database/constants";
import { NO_TOOL_SUPPORT } from "@/services/llm/interfaces/tool-capability";
import type { BaseEmbedding } from "@/services/embedding/interfaces/base-embedding";
import type { BaseLLM } from "@/services/llm/interfaces/base-llm";

const backgroundExecute = vi.hoisted(() => vi.fn());
const dbTransaction = vi.hoisted(() => vi.fn());
const dbUse = vi.hoisted(() => vi.fn());
const initDB = vi.hoisted(() => vi.fn(async () => undefined));
const closeDB = vi.hoisted(() => vi.fn(async () => undefined));
const healthCheck = vi.hoisted(() => vi.fn(async () => ({ healthy: true })));
const rpcStartListening = vi.hoisted(() => vi.fn());
const rpcStop = vi.hoisted(() => vi.fn());

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: {
		isAvailable: vi.fn(() => false),
		set: vi.fn(async () => undefined),
		subscribe: vi.fn(() => vi.fn()),
	},
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: dbUse,
		},
	},
}));

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: {
		execute: backgroundExecute,
	},
}));

const createMockLLM = (): BaseLLM =>
	({
		initialize: vi.fn(async () => undefined),
		isReady: vi.fn(() => true),
		getInfo: vi.fn(() => ({ name: "mock", type: "openai", ready: true })),
		models: vi.fn(async () => ({
			object: "list",
			data: [
				{
					id: "model-a",
					name: "Model A",
					object: "model",
					created: 1,
					owned_by: "openai",
					loaded: true,
				},
			],
		})),
		chatCompletions: vi.fn(async () => ({
			id: "response",
			object: "chat.completion",
			created: 1,
			model: "model-a",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "ok" },
					finish_reason: "stop",
				},
			],
		})),
		unload: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
		getMaxModelTokens: vi.fn(async () => 8192),
		getMaxResponseTokens: vi.fn(async () => 1024),
		getToolCapabilities: vi.fn(async () => ({
			supported: true,
			mode: "native",
		})),
	}) as unknown as BaseLLM;

vi.mock("@/services/llm/implementations/openai-llm", () => ({
	OpenAILLM: vi.fn(function MockOpenAILLM() {
		return createMockLLM();
	}),
}));

vi.mock("@/services/llm/implementations/local-openai-llm", () => ({
	LocalOpenAICompatibleLLM: vi.fn(function MockLocalOpenAILLM() {
		return createMockLLM();
	}),
}));

vi.mock("@/services/llm/implementations/wllama-llm", () => ({
	WllamaLLM: vi.fn(function MockWllamaLLM() {
		return createMockLLM();
	}),
}));

vi.mock("@/services/llm/implementations/webllm-llm", () => ({
	WebLLMLLM: vi.fn(function MockWebLLM() {
		return createMockLLM();
	}),
}));

vi.mock("@/services/llm/implementations/transformer-llm", () => ({
	TransformerLLM: vi.fn(function MockTransformerLLM() {
		return createMockLLM();
	}),
}));

vi.mock("@/utils/embedding-size-config", () => ({
	getCurrentModelId: vi.fn(async () => "test-embedding-model"),
}));

const createMockEmbedding = (): BaseEmbedding => ({
	name: "mock",
	dimensions: 3,
	initialize: vi.fn(async () => undefined),
	isReady: vi.fn(() => true),
	textToVector: vi.fn(async () => [1, 0, 0]),
	textsToVectors: vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
	getInfo: vi.fn(() => ({
		name: "mock",
		dimensions: 3,
		type: "local" as const,
	})),
});

vi.mock("@/services/embedding/implementations/local-embedding", () => ({
	LocalEmbedding: vi.fn(function MockLocalEmbedding() {
		return createMockEmbedding();
	}),
}));

vi.mock("@/services/embedding/implementations/openai-embedding", () => ({
	OpenAIEmbedding: vi.fn(function MockOpenAIEmbedding() {
		return createMockEmbedding();
	}),
}));

vi.mock("@/services/embedding/implementations/worker-embedding", () => ({
	WorkerEmbedding: vi.fn(function MockWorkerEmbedding() {
		return createMockEmbedding();
	}),
}));

vi.mock("@/services/database/db", () => ({
	initDB,
	getDB: vi.fn(() => ({
		transaction: dbTransaction,
	})),
	getPGLite: vi.fn(() => ({
		query: vi.fn(async () => ({ rows: [] })),
	})),
	healthCheck,
	closeDB,
	getCurrentMode: vi.fn(() => DatabaseMode.MAIN),
	isMainMode: vi.fn(() => true),
	isProxyMode: vi.fn(() => false),
}));

vi.mock("@/services/database/bridges/rpc-handler", () => ({
	DatabaseRpcHandler: {
		getInstance: vi.fn(() => ({
			startListening: rpcStartListening,
			stop: rpcStop,
		})),
	},
}));

class TestLLMService extends (await import("@/services/llm/llm-service-core"))
	.LLMServiceCore {
	async create(name: string) {
		const llm = createMockLLM();
		this.llms.set(name, llm);
		return llm;
	}

	async get(name: string) {
		return this.llms.get(name);
	}

	isReady() {
		return this.list().some((name) => this.isReadyByName(name));
	}

	async ensureAllServices() {}
}

class TestEmbeddingService extends (
	await import("@/services/embedding/embedding-service-core")
).EmbeddingServiceCore {
	async create(name: string) {
		const embedding = createMockEmbedding();
		this.embeddings.set(name, embedding);
		return embedding;
	}

	async get(name: string) {
		return this.embeddings.get(name) ?? null;
	}

	protected async createDefaultEmbedding() {
		await this.create(this.defaultName);
	}
}

class TestDatabaseService extends (
	await import("@/services/database/database-service-core")
).DatabaseServiceCore {
	initializeCount = 0;

	protected async initializeDatabase() {
		this.initializeCount += 1;
	}

	async getStatus() {
		return {
			initialized: this.initialized,
			mode: DatabaseMode.MAIN,
			isMainMode: true,
			isProxyMode: false,
			tableCount: 0,
			availableTables: [],
			healthy: this.initialized,
			healthCheck: null,
		};
	}

	getMode() {
		return DatabaseMode.MAIN;
	}

	isMainMode() {
		return true;
	}

	isProxyMode() {
		return false;
	}

	async healthCheck() {
		return this.initialized;
	}

	async close() {
		this.initialized = false;
	}

	hasTable() {
		return false;
	}

	getTableNames() {
		return [];
	}

	async use<T>(
		fn: (ctx: any) => Promise<T> | T,
		options?: { transaction?: boolean },
	): Promise<T> {
		await this.ensureInitialized();
		const ctx = { db: {}, schema: {}, raw: vi.fn() };
		return options?.transaction
			? await fn({ ...ctx, transaction: true })
			: await fn(ctx);
	}
}

describe("LLM service main classes", () => {
	it("covers shared core registry, current model, and capability behavior", async () => {
		dbUse.mockResolvedValue([]);
		const service = new TestLLMService();
		const listener = vi.fn();
		const unsubscribe = service.onCurrentModelChange(listener);

		await service.create("mock");
		expect(service.list()).toEqual(["mock"]);
		expect(service.getInfoFor("mock")).toEqual({
			name: "mock",
			type: "openai",
			ready: true,
		});
		expect(await service.supportsToolsFor("mock")).toBe(true);
		expect(await service.getToolCapabilities()).toEqual(NO_TOOL_SUPPORT);

		await service.setCurrentModel("openai", "model-a", "mock");
		expect(listener).toHaveBeenCalledWith({
			provider: "openai",
			modelId: "model-a",
			serviceName: "mock",
		});
		expect(await service.getMaxModelTokens()).toBe(8192);

		unsubscribe();
		service.clear();
		expect(service.list()).toEqual([]);
	});

	it("creates and delegates through LLMServiceMain", async () => {
		const { LLMServiceMain } = await import("@/services/llm/llm-service-main");
		const service = new LLMServiceMain();
		await service.create("openai", { type: "openai", apiKey: "key" });

		await expect(
			service.create("openai", { type: "openai", apiKey: "key" }),
		).rejects.toThrow('LLM with name "openai" already exists');
		await expect(service.modelsFor("openai")).resolves.toMatchObject({
			object: "list",
		});
		await expect(
			service.chatCompletionsFor("openai", {
				messages: [{ role: "user", content: "hi" }],
				stream: false,
			}),
		).resolves.toMatchObject({ object: "chat.completion" });
	});

	it("creates heavy LLM proxies through background jobs in proxy mode", async () => {
		const { LLMServiceProxy } = await import(
			"@/services/llm/llm-service-proxy"
		);
		backgroundExecute.mockResolvedValueOnce({
			promise: Promise.resolve({ status: "completed", result: { ok: true } }),
		});

		const service = new LLMServiceProxy();
		const llm = await service.create("webllm", {
			type: "webllm",
			url: "iframe.html",
		});

		expect(llm.isReady()).toBe(true);
		expect(service.has("webllm")).toBe(true);
	});
});

describe("embedding service main classes", () => {
	it("covers shared core storage and default operations", async () => {
		const service = new TestEmbeddingService();
		await service.create("named");

		expect(service.list()).toEqual(["named"]);
		expect(service.getInfoFor("named")).toEqual({
			name: "mock",
			type: "local",
			ready: true,
		});
		await expect(service.textToVectorFor("named", "hello")).resolves.toEqual([
			1, 0, 0,
		]);
		expect(service.remove("named")).toBe(true);
	});

	it("creates concrete embeddings in main mode", async () => {
		const { EmbeddingServiceMain } = await import(
			"@/services/embedding/embedding-service-main"
		);
		const service = new EmbeddingServiceMain();

		await service.create("local", "local", { type: "local" });
		await service.create("openai", "openai", {
			type: "openai",
			modelName: "text-embedding-3-small",
		});
		await service.create("worker", "worker", { type: "worker" });

		expect(service.list().sort()).toEqual(["local", "openai", "worker"]);
		await expect(service.create("bad", "custom", {})).rejects.toThrow(
			"Custom embedding implementation not yet supported",
		);
	});

	it("delegates proxy embedding operations to background jobs", async () => {
		const { EmbeddingServiceProxy } = await import(
			"@/services/embedding/embedding-service-proxy"
		);
		backgroundExecute.mockImplementation(async (jobType: string) => ({
			promise: Promise.resolve({
				status: "completed",
				result:
					jobType === "texts-to-vectors"
						? { vectors: [[1, 0, 0]] }
						: {
								vector: [1, 0, 0],
								embeddingInfo: { exists: true, type: "worker" },
							},
			}),
		}));

		const service = new EmbeddingServiceProxy();
		await expect(service.textToVector("hello")).resolves.toEqual([1, 0, 0]);
		await expect(service.textsToVectors(["hello"])).resolves.toEqual([
			[1, 0, 0],
		]);
	});
});

describe("database service main classes", () => {
	it("initializes the core service only once and supports transactions", async () => {
		const service = new TestDatabaseService();
		await service.initialize({ mode: DatabaseMode.MAIN });
		await service.initialize({ mode: DatabaseMode.PROXY });

		expect(service.initializeCount).toBe(1);
		expect(service.getConfig()).toEqual({ mode: DatabaseMode.MAIN });
		await expect(
			service.transaction((ctx) => (ctx as any).transaction),
		).resolves.toBe(true);
	});

	it("covers DatabaseServiceMain status, use, and close", async () => {
		const { DatabaseServiceMain } = await import(
			"@/services/database/database-service-main"
		);
		dbTransaction.mockImplementation(async (fn) => fn({ tx: true }));
		const service = new DatabaseServiceMain();

		await service.initialize({
			mode: DatabaseMode.MAIN,
			proxyOptions: { channelName: "test-channel" },
		});
		expect(initDB).toHaveBeenCalled();
		expect(rpcStartListening).toHaveBeenCalledWith("test-channel");
		expect(service.hasTable("messages")).toBe(true);
		expect((await service.getStatus()).healthy).toBe(true);
		await expect(service.use((ctx) => ctx.schema)).resolves.toBeTruthy();
		await service.close();
		expect(closeDB).toHaveBeenCalled();
		expect(rpcStop).toHaveBeenCalled();
	});
});
