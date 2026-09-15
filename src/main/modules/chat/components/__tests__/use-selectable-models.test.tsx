import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	list: vi.fn<() => string[]>(() => []),
	dbRows: vi.fn(async () => [] as Array<{ key: string }>),
	secureExists: vi.fn(async () => false),
	modelsFor: vi.fn(async (_service: string) => ({
		object: "list" as const,
		data: [] as Array<Record<string, unknown>>,
	})),
	setCurrentModelFor: vi.fn(async () => undefined),
	serveFor: vi.fn(async () => undefined),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			list: mocks.list,
			modelsFor: mocks.modelsFor,
			setCurrentModelFor: mocks.setCurrentModelFor,
			serveFor: mocks.serveFor,
			// The real rule lives in the provider registry; the tests below only
			// need "chat providers serve chat, media providers serve media".
			supportsCategoryFor: (service: string, category: string) =>
				category === "chat"
					? service !== "transformer-media"
					: ["transformer-media", "openai"].includes(service),
		},
		databaseService: {
			use: vi.fn(async () => mocks.dbRows()),
		},
	},
}));

vi.mock("@/utils/secure-session", () => ({
	default: { exists: mocks.secureExists },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => undefined) }));

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { useSelectableModels } from "@/main/hooks/use-selectable-models";

const model = (over: Record<string, unknown>) => ({
	object: "model",
	created: 0,
	owned_by: "x",
	loaded: false,
	...over,
});

describe("useSelectableModels", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.list.mockReturnValue([]);
		mocks.modelsFor.mockResolvedValue({ object: "list", data: [] });
		mocks.dbRows.mockResolvedValue([]);
		mocks.secureExists.mockResolvedValue(false);
	});

	it("gathers models from every configured provider", async () => {
		mocks.list.mockReturnValue(["openai", "openrouter"]);
		mocks.modelsFor.mockImplementation(async (service: string) => ({
			object: "list" as const,
			data: [model({ id: `${service}-a`, provider: service })],
		}));

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.models).toHaveLength(2));
		expect(result.current.byProvider.size).toBe(2);
	});

	it("carries a local model's download size, from the runner or its catalog", async () => {
		const { toSelectable } = await import("@/main/hooks/use-selectable-models");

		expect(
			toSelectable(
				{
					id: "org/speech-model",
					object: "model",
					created: 0,
					owned_by: "transformer-media",
					provider: "transformer-media",
					loaded: false,
					downloaded: true,
					size: 900,
					sizeByDevice: { webgpu: 900, wasm: 300 },
					categories: ["text-to-speech"],
				},
				"transformer-media",
				"text-to-speech",
			),
		).toMatchObject({ size: 900, sizeByDevice: { webgpu: 900, wasm: 300 } });

		const hosted = toSelectable(
			{
				id: "gpt-4o-mini",
				object: "model",
				created: 0,
				owned_by: "openai",
				provider: "openai",
				loaded: false,
				size: 5,
			},
			"openai",
		);
		expect(hosted).not.toHaveProperty("size");
	});

	it("hides a local model that has not been downloaded", async () => {
		// Choosing it from a dropdown would start a multi-gigabyte download from a
		// control that looks instant.
		mocks.list.mockReturnValue(["wllama"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [
				model({ id: "downloaded.gguf", provider: "wllama", downloaded: true }),
				model({ id: "remote-only.gguf", provider: "wllama" }),
			],
		});

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.models.map((entry) => entry.id)).toEqual([
			"downloaded.gguf",
		]);
	});

	it("keeps every hosted model, downloaded or not", async () => {
		mocks.list.mockReturnValue(["openrouter"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [
				model({ id: "vendor/a", provider: "openrouter" }),
				model({ id: "vendor/b", provider: "openrouter" }),
			],
		});

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.models).toHaveLength(2));
	});

	it("survives one provider failing without losing the others", async () => {
		mocks.list.mockReturnValue(["openai", "ollama"]);
		mocks.modelsFor.mockImplementation(async (service: string) => {
			if (service === "ollama") throw new Error("connection refused");
			return {
				object: "list" as const,
				data: [model({ id: "gpt-4o-mini", provider: "openai" })],
			};
		});

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.models).toHaveLength(1));
		expect(result.current.error).toBeNull();
	});

	it("records the choice before loading it", async () => {
		mocks.list.mockReturnValue(["openai"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [model({ id: "gpt-4o-mini", provider: "openai" })],
		});

		const { result } = renderHook(() => useSelectableModels());
		await waitFor(() => expect(result.current.models).toHaveLength(1));

		const ok = await result.current.selectModel(result.current.models[0]);

		expect(ok).toBe(true);
		// Recorded first: a load that fails still leaves the choice visible.
		expect(mocks.setCurrentModelFor).toHaveBeenCalledWith(
			"chat",
			"openai",
			"gpt-4o-mini",
			"openai",
		);
		expect(mocks.serveFor).toHaveBeenCalledWith(
			"openai",
			"gpt-4o-mini",
			undefined,
			{ category: "chat" },
		);
	});

	it("keeps models whose id names another capability out of the chat picker", async () => {
		mocks.list.mockReturnValue(["openai"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [
				model({ id: "acme-chat", provider: "openai" }),
				model({ id: "acme-tts", provider: "openai" }),
				model({ id: "acme-transcribe", provider: "openai" }),
				model({ id: "acme-image-1", provider: "openai" }),
				model({ id: "acme-embedding", provider: "openai" }),
			],
		});

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.models.map((entry) => entry.id)).toEqual([
			"acme-chat",
		]);
	});

	it("lists a category's models, recognised first, including local runners not yet created", async () => {
		mocks.list.mockReturnValue(["openai", "wllama"]);
		mocks.modelsFor.mockImplementation(async (service: string) => {
			if (service === "openai") {
				return {
					object: "list" as const,
					data: [
						model({ id: "acme-chat", provider: "openai" }),
						model({ id: "acme-tts", provider: "openai" }),
						model({ id: "acme-transcribe", provider: "openai" }),
					],
				};
			}
			if (service === "transformer-media") {
				return {
					object: "list" as const,
					data: [
						model({
							id: "org/speech-model",
							provider: "transformer-media",
							downloaded: true,
							categories: ["text-to-speech"],
						}),
						model({
							id: "org/asr-model",
							provider: "transformer-media",
							downloaded: true,
							categories: ["speech-to-text"],
						}),
					],
				};
			}
			return { object: "list" as const, data: [] };
		});

		const { result } = renderHook(() => useSelectableModels("text-to-speech"));

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		// A hosted model with an uninformative id is still offered, after the
		// ones recognised as speech; models of another known kind are not.
		expect(
			result.current.byProvider.get("openai")?.map((entry) => entry.id),
		).toEqual(["acme-tts", "acme-chat"]);
		expect(
			result.current.byProvider
				.get("transformer-media")
				?.map((entry) => entry.id),
		).toEqual(["org/speech-model"]);
		expect(mocks.modelsFor).not.toHaveBeenCalledWith("wllama");

		await result.current.selectModel(
			result.current.models.find(
				(entry) => entry.provider === "transformer-media",
			)!,
		);
		expect(mocks.setCurrentModelFor).toHaveBeenCalledWith(
			"text-to-speech",
			"transformer-media",
			"org/speech-model",
			"transformer-media",
		);
	});

	it("reports a failed switch instead of throwing at the composer", async () => {
		mocks.list.mockReturnValue(["openai"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [model({ id: "gpt-4o-mini", provider: "openai" })],
		});
		mocks.serveFor.mockRejectedValue(new Error("out of memory"));

		const { result } = renderHook(() => useSelectableModels());
		await waitFor(() => expect(result.current.models).toHaveLength(1));

		const ok = await result.current.selectModel(result.current.models[0]);

		expect(ok).toBe(false);
		await waitFor(() =>
			expect(result.current.error).toContain("out of memory"),
		);
	});
});

describe("useSelectableModels: providers that need unlocking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.list.mockReturnValue([]);
		mocks.modelsFor.mockResolvedValue({ object: "list", data: [] });
		mocks.dbRows.mockResolvedValue([]);
		mocks.secureExists.mockResolvedValue(false);
	});

	it("names a configured provider whose key is still locked", async () => {
		// ensureAllServices restores only local providers and the current model's
		// service, so a configured OpenRouter is missing from list() until someone
		// unlocks it — which read as "No models yet", which the user cannot act on.
		mocks.dbRows.mockResolvedValue([{ key: "openrouter_config" }]);

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() =>
			expect(result.current.lockedProviders).toContain("openrouter"),
		);
	});

	it("says nothing about a provider that is already unlocked", async () => {
		mocks.dbRows.mockResolvedValue([{ key: "openrouter_config" }]);
		mocks.secureExists.mockResolvedValue(true);

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.lockedProviders).toEqual([]);
	});

	it("says nothing about a provider already loaded in this context", async () => {
		mocks.list.mockReturnValue(["openrouter"]);
		mocks.dbRows.mockResolvedValue([{ key: "openrouter_config" }]);

		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.lockedProviders).toEqual([]);
	});

	it("says nothing when the provider was never configured", async () => {
		const { result } = renderHook(() => useSelectableModels());

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.lockedProviders).toEqual([]);
	});

	it("picks up a provider that became ready after mount", async () => {
		const { result } = renderHook(() => useSelectableModels());
		await waitFor(() => expect(result.current.models).toHaveLength(0));

		// The user unlocked it on the models page; the picker re-reads on open.
		mocks.list.mockReturnValue(["openrouter"]);
		mocks.modelsFor.mockResolvedValue({
			object: "list",
			data: [
				{
					id: "vendor/a",
					object: "model",
					created: 0,
					owned_by: "x",
					loaded: false,
					provider: "openrouter",
				},
			],
		});
		await result.current.refresh();

		await waitFor(() => expect(result.current.models).toHaveLength(1));
	});
});
