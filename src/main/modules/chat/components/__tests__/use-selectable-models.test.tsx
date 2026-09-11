import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	list: vi.fn<() => string[]>(() => []),
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
	},
}));

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
