import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelsResponse } from "@/services/llm/interfaces/base-llm";

const mocks = vi.hoisted(() => ({
	has: vi.fn(() => true),
	modelsFor: vi.fn<() => Promise<ModelsResponse>>(),
}));

vi.mock("@/services", () => ({
	serviceManager: { llmService: mocks },
}));
vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

import { useLocalModels } from "../use-local-models";

const models = (id: string): ModelsResponse => ({
	object: "list",
	data: [
		{
			id,
			object: "model",
			created: 0,
			owned_by: "custom",
			provider: "custom",
			loaded: true,
		},
	],
});

beforeEach(() => {
	mocks.has.mockReturnValue(true);
	mocks.modelsFor.mockReset();
});

describe("custom provider model refresh", () => {
	it("keeps models from the edited endpoint when the old request finishes later", async () => {
		let finishOld!: (value: ModelsResponse) => void;
		mocks.modelsFor.mockReturnValueOnce(
			new Promise((resolve) => {
				finishOld = resolve;
			}),
		);
		mocks.modelsFor.mockResolvedValueOnce(models("new-model"));
		const { result, rerender } = renderHook(
			({ revision }) => useLocalModels("custom", null, true, revision),
			{ initialProps: { revision: 0 } },
		);
		await waitFor(() => expect(mocks.modelsFor).toHaveBeenCalledTimes(1));
		rerender({ revision: 1 });
		await waitFor(() =>
			expect(result.current.localModels[0]?.id).toBe("new-model"),
		);
		await act(async () => {
			finishOld(models("old-model"));
		});
		expect(result.current.localModels.map((model) => model.id)).toEqual([
			"new-model",
		]);
		expect(result.current.localModelsLoading).toBe(false);
	});

	it("clears the model list after removing a custom configuration", async () => {
		mocks.modelsFor.mockResolvedValue(models("custom-model"));
		const { result, rerender } = renderHook(
			({ ready }) => useLocalModels("custom", null, ready),
			{ initialProps: { ready: true } },
		);
		await waitFor(() => expect(result.current.localModels).toHaveLength(1));
		mocks.has.mockReturnValue(false);
		rerender({ ready: false });
		expect(result.current.localModels).toEqual([]);
		expect(result.current.localModelsLoading).toBe(false);
	});
});
