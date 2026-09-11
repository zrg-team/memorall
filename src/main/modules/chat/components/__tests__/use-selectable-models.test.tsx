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
	setCurrentModel: vi.fn(async () => undefined),
	serveFor: vi.fn(async () => undefined),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			list: mocks.list,
			modelsFor: mocks.modelsFor,
			setCurrentModel: mocks.setCurrentModel,
			serveFor: mocks.serveFor,
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
		expect(mocks.setCurrentModel).toHaveBeenCalledWith(
			"openai",
			"gpt-4o-mini",
			"openai",
		);
		expect(mocks.serveFor).toHaveBeenCalledWith("openai", "gpt-4o-mini");
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
