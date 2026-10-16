import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionRequest } from "@/types/openai";

/** Saved settings rows, by configuration key. */
const saved = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const listeners = vi.hoisted(
	() => new Map<string, Array<(event: { newValue: unknown }) => void>>(),
);

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: (_column: unknown, value: unknown) => ({ value }),
}));

vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: {
		isAvailable: vi.fn(() => true),
		set: vi.fn(async () => undefined),
		get: vi.fn(async () => null),
		subscribe: vi.fn(
			(key: string, listener: (event: { newValue: unknown }) => void) => {
				listeners.set(key, [...(listeners.get(key) ?? []), listener]);
				return vi.fn();
			},
		),
	},
}));

vi.mock("@/services", () => {
	const rowsFor = (where: { value: string }) => {
		const data = saved.get(where.value);
		return data ? [{ key: where.value, data }] : [];
	};
	const db = {
		select: () => ({
			from: () => ({
				where: (where: { value: string }) =>
					Object.assign(Promise.resolve(rowsFor(where)), {
						limit: async () => rowsFor(where),
					}),
			}),
		}),
	};
	return {
		serviceManager: {
			databaseService: {
				use: vi.fn(async (work: (deps: unknown) => unknown) =>
					work({ db, schema: { configurations: { key: "key" } } }),
				),
			},
		},
	};
});

/** One local server client per service made, with the URL it was made on. */
const { made, LocalServer } = vi.hoisted(() => {
	const made: Array<{ baseURL: string; provider: string }> = [];
	const LocalServer = vi.fn(function LocalServer(
		baseURL: string,
		_apiKey: string | undefined,
		provider: string,
	) {
		made.push({ baseURL, provider });
		const reply = { id: "r", object: "chat.completion", choices: [] };
		return {
			baseURL,
			initialize: vi.fn(async () => undefined),
			isReady: vi.fn(() => true),
			models: vi.fn(async () => ({ object: "list", data: [] })),
			chatCompletions: vi.fn((request: { stream?: boolean }) =>
				request.stream
					? (async function* () {
							yield { id: "c", object: "chat.completion.chunk", choices: [] };
						})()
					: Promise.resolve(reply),
			),
			unload: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		};
	});
	return { made, LocalServer };
});

vi.mock("../implementations/local-openai-llm", () => ({
	LocalOpenAICompatibleLLM: LocalServer,
}));

import { LOCAL_SERVER_LLM_CONFIG_KEYS } from "@/config/local-server-llm";
import { LOCAL_SERVERS_CHANGED_KEY } from "../constants";
import { LLMServiceMain } from "../llm-service-main";
import { LLMServiceProxy } from "../llm-service-proxy";

const OLLAMA_URL = "http://127.0.0.1:11434/v1";
const request = (stream = false): ChatCompletionRequest => ({
	model: "llama-4",
	messages: [{ role: "user", content: "hi" }],
	stream,
});

const saveOllama = (baseUrl = OLLAMA_URL) =>
	saved.set(LOCAL_SERVER_LLM_CONFIG_KEYS.OLLAMA, {
		baseUrl,
		modelId: "llama-4",
	});

const announceChange = () => {
	for (const listener of listeners.get(LOCAL_SERVERS_CHANGED_KEY) ?? []) {
		listener({ newValue: Date.now() });
	}
};

describe.each([
	["the offscreen service", LLMServiceMain],
	["a page's service", LLMServiceProxy],
])("a local server in %s", (_label, Service) => {
	beforeEach(() => {
		vi.clearAllMocks();
		saved.clear();
		listeners.clear();
		made.length = 0;
	});

	it("is made on first use when it was saved after startup", async () => {
		const service = new Service();
		await service.initialize();
		expect(service.has("ollama")).toBe(false);

		saveOllama();
		await expect(
			service.chatCompletionsFor("ollama", request()),
		).resolves.toMatchObject({ object: "chat.completion" });

		expect(made).toEqual([{ baseURL: OLLAMA_URL, provider: "ollama" }]);
		expect(service.has("ollama")).toBe(true);
	});

	it("is made for a streamed reply too", async () => {
		const service = new Service();
		saveOllama();
		const chunks = [];
		for await (const chunk of service.chatCompletionsFor(
			"ollama",
			request(true),
		) as AsyncIterable<unknown>) {
			chunks.push(chunk);
		}
		expect(chunks).toHaveLength(1);
		expect(made).toHaveLength(1);
	});

	it("is made once when two requests need it at the same time", async () => {
		const service = new Service();
		saveOllama();
		await Promise.all([
			service.chatCompletionsFor("ollama", request()),
			service.chatCompletionsFor("ollama", request()),
			service.unloadFor("ollama", "llama-4"),
		]);
		expect(made).toHaveLength(1);
	});

	it("is still not found when nothing is saved", async () => {
		const service = new Service();
		await expect(
			service.chatCompletionsFor("ollama", request()),
		).rejects.toThrow(/"ollama" not found/);
		expect(made).toEqual([]);
	});

	it("follows its settings when they change", async () => {
		saveOllama();
		const service = new Service();
		await service.initialize();
		expect(made.map((entry) => entry.baseURL)).toEqual([OLLAMA_URL]);

		saveOllama("http://192.168.1.20:11434/v1");
		announceChange();
		await vi.waitFor(() => expect(made).toHaveLength(2));
		expect(made[1]?.baseURL).toBe("http://192.168.1.20:11434/v1");
		expect(service.has("ollama")).toBe(true);

		saved.clear();
		announceChange();
		await vi.waitFor(() => expect(service.has("ollama")).toBe(false));
	});
});
