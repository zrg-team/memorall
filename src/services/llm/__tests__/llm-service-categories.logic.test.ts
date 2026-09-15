import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLLM, ModelInfo } from "../interfaces/base-llm";
import type { ModelCategory } from "../interfaces/model-category";

const dbUse = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const sharedSet = vi.hoisted(() =>
	vi.fn(async (_key: string, _value: unknown) => undefined),
);

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: {
		isAvailable: vi.fn(() => true),
		set: sharedSet,
		get: vi.fn(async () => null),
		subscribe: vi.fn(() => vi.fn()),
	},
}));

vi.mock("@/services", () => ({
	serviceManager: { databaseService: { use: dbUse } },
}));

/**
 * A runner that loads whatever it is asked to serve or chat with. Media
 * runners report each model's category, as the real one does from the
 * model's pipeline task.
 */
function createRunner(
	name: string,
	options: { categories?: ModelCategory[]; extra?: Partial<BaseLLM> } = {},
) {
	const loaded = new Set<string>();
	const info = (id: string): ModelInfo => ({
		id,
		object: "model",
		created: 0,
		owned_by: name,
		loaded: loaded.has(id),
		downloaded: true,
		...(options.categories ? { categories: options.categories } : {}),
	});
	return {
		name,
		loaded,
		initialize: vi.fn(async () => undefined),
		isReady: vi.fn(() => true),
		getInfo: vi.fn(() => ({ name, type: name, ready: true })),
		models: vi.fn(async () => ({
			object: "list" as const,
			data: [...loaded].map(info),
		})),
		serve: vi.fn(async (id: string) => {
			loaded.add(id);
			return info(id);
		}),
		chatCompletions: vi.fn(async (request: { model?: string }) => {
			if (request.model) loaded.add(request.model);
			return {
				id: "r",
				object: "chat.completion",
				created: 0,
				model: request.model,
				choices: [],
			};
		}),
		unload: vi.fn(async (id: string) => {
			loaded.delete(id);
		}),
		delete: vi.fn(async () => undefined),
		getMaxModelTokens: vi.fn(async () => 4096),
		getMaxResponseTokens: vi.fn(async () => 512),
		getToolCapabilities: vi.fn(async () => ({ supported: false })),
		supportsTools: vi.fn(async () => false),
		destroy: vi.fn(),
		...options.extra,
	};
}

const { runners, mockImplementation } = vi.hoisted(() => {
	const runners = new Map<string, ReturnType<typeof createRunner>>();
	const mockImplementation = (name: string) =>
		vi.fn(function MockRunner() {
			const runner = runners.get(name);
			if (!runner) throw new Error(`no runner fixture for ${name}`);
			return runner;
		});
	return { runners, mockImplementation };
});

vi.mock("../implementations/wllama-llm", () => ({
	WllamaLLM: mockImplementation("wllama"),
}));
vi.mock("../implementations/webllm-llm", () => ({
	WebLLMLLM: mockImplementation("webllm"),
}));
vi.mock("../implementations/transformer-llm", () => ({
	TransformerLLM: mockImplementation("transformer"),
}));
vi.mock("../implementations/transformer-media-llm", () => ({
	TransformerMediaLLM: mockImplementation("transformer-media"),
}));
vi.mock("../implementations/openai-llm", () => ({
	OpenAILLM: mockImplementation("openai"),
}));
vi.mock("../implementations/local-openai-llm", () => ({
	LocalOpenAICompatibleLLM: mockImplementation("ollama"),
}));

import {
	CURRENT_MODEL_KEY,
	CURRENT_MODELS_BY_CATEGORY_KEY,
} from "../constants";
import { UnsupportedModelOperationError } from "../llm-service-core";
import { LLMServiceMain } from "../llm-service-main";

const MEDIA = "transformer-media";
const SPEECH_MODEL = "org/speech-model";

async function createService() {
	const service = new LLMServiceMain();
	for (const name of ["wllama", MEDIA, "openai"]) {
		await service.create(name, { type: name } as never);
	}
	return service;
}

const writesTo = (key: string) =>
	sharedSet.mock.calls.filter(([writtenKey]) => writtenKey === key);

describe("per-category model selection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		runners.clear();
		runners.set("wllama", createRunner("wllama"));
		runners.set(
			MEDIA,
			createRunner(MEDIA, {
				categories: ["text-to-speech"],
				extra: {
					audioSpeech: vi.fn(async (request) => ({
						object: "audio.speech" as const,
						model: request.model,
						voice: request.voice,
						audio: { kind: "base64" as const, data: "", mimeType: "audio/wav" },
						sample_rate: 16_000,
						duration_ms: 0,
					})),
				},
			}),
		);
		runners.set(
			"openai",
			createRunner("openai", { extra: { serve: undefined } }),
		);
	});

	it("serving a speech model never replaces the chat model", async () => {
		const service = await createService();
		await service.serveFor("wllama", "chat.gguf");
		expect(await service.getCurrentModel()).toMatchObject({
			modelId: "chat.gguf",
		});
		sharedSet.mockClear();

		await service.serveFor(MEDIA, SPEECH_MODEL);

		expect(await service.getCurrentModel()).toMatchObject({
			modelId: "chat.gguf",
			serviceName: "wllama",
		});
		expect(await service.getCurrentModelFor("text-to-speech")).toEqual({
			modelId: SPEECH_MODEL,
			provider: MEDIA,
			serviceName: MEDIA,
		});
		expect(writesTo(CURRENT_MODEL_KEY)).toHaveLength(0);
		expect(writesTo(CURRENT_MODELS_BY_CATEGORY_KEY)).toHaveLength(1);
	});

	it("keeps one local model in memory across categories", async () => {
		const service = await createService();
		await service.serveFor("wllama", "chat.gguf");
		await service.serveFor(MEDIA, SPEECH_MODEL);

		expect(runners.get("wllama")?.loaded.size).toBe(0);
		expect(runners.get(MEDIA)?.loaded.has(SPEECH_MODEL)).toBe(true);

		// An agent turn lazily brings the chat model back and evicts speech.
		await service.chatCompletionsFor("wllama", {
			model: "chat.gguf",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(runners.get(MEDIA)?.loaded.size).toBe(0);
		expect(runners.get(MEDIA)?.destroy).toHaveBeenCalled();
		expect(runners.get("wllama")?.loaded.has("chat.gguf")).toBe(true);
	});

	it("files a hosted media model under its own category", async () => {
		const service = await createService();
		await service.serveFor("wllama", "chat.gguf");

		await service.serveFor("openai", "acme-transcribe");

		expect((await service.getCurrentModel())?.modelId).toBe("chat.gguf");
		expect((await service.getCurrentModelFor("speech-to-text"))?.modelId).toBe(
			"acme-transcribe",
		);
		// A hosted transcription model does not need the chat model gone.
		expect(runners.get("wllama")?.loaded.has("chat.gguf")).toBe(true);
	});

	it("frees local memory when chat moves to a hosted model", async () => {
		const service = await createService();
		await service.serveFor("wllama", "chat.gguf");

		await service.serveFor("openai", "acme-chat");

		expect((await service.getCurrentModel())?.serviceName).toBe("openai");
		expect(runners.get("wllama")?.loaded.size).toBe(0);
	});

	it("honours an explicit category and select: false", async () => {
		const service = await createService();

		await service.serveFor("openai", "acme-chat", undefined, {
			category: "image-generation",
		});
		expect(
			(await service.getCurrentModelFor("image-generation"))?.modelId,
		).toBe("acme-chat");

		await service.serveFor(MEDIA, SPEECH_MODEL, undefined, { select: false });
		expect(await service.getCurrentModelFor("text-to-speech")).toBeNull();
	});

	it("records nothing for a media model whose category is unknown", async () => {
		runners.set(MEDIA, createRunner(MEDIA));
		const service = await createService();

		await service.serveFor(MEDIA, "org/undescribed");

		expect(await service.getCurrentModel()).toBeNull();
		expect(await service.getCurrentModels()).toEqual({});
	});

	it("clears every selection a removed provider served", async () => {
		const service = await createService();
		await service.serveFor("openai", "acme-chat");
		await service.serveFor("openai", "acme-transcribe");
		await service.serveFor(MEDIA, SPEECH_MODEL);
		const changes = vi.fn();
		service.onCurrentModelsChange(changes);

		await service.clearCurrentModelsForProvider("openai");

		expect(await service.getCurrentModel()).toBeNull();
		expect(await service.getCurrentModelFor("speech-to-text")).toBeNull();
		expect((await service.getCurrentModelFor("text-to-speech"))?.modelId).toBe(
			SPEECH_MODEL,
		);
		expect(changes).toHaveBeenCalledWith("speech-to-text", null);
		expect(changes).toHaveBeenCalledWith("chat", null);
	});

	it("routes media calls through the lease and rejects unsupported ones", async () => {
		const service = await createService();
		await service.serveFor("wllama", "chat.gguf");

		await service.audioSpeechFor(MEDIA, {
			model: SPEECH_MODEL,
			input: "Hello",
			voice: "default",
		});
		expect(runners.get("wllama")?.loaded.size).toBe(0);

		await expect(
			service.audioTranscriptionsFor(MEDIA, {
				model: SPEECH_MODEL,
				file: { kind: "base64", data: "", mimeType: "audio/wav" },
			}),
		).rejects.toBeInstanceOf(UnsupportedModelOperationError);
	});

	it("reports category support from the provider registry", async () => {
		const service = await createService();
		expect(service.supportsCategoryFor(MEDIA, "text-to-speech")).toBe(true);
		expect(service.supportsCategoryFor(MEDIA, "chat")).toBe(false);
		expect(service.supportsCategoryFor("openai", "image-generation")).toBe(
			true,
		);
		expect(service.supportsCategoryFor("custom-service", "chat")).toBe(true);
	});
});
