import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";

const llmService = vi.hoisted(() => ({
	getCurrentModel: vi.fn(),
	has: vi.fn(),
	clearCurrentModel: vi.fn(),
	onCurrentModelChange: vi.fn(),
}));

vi.mock("@/services", () => ({
	serviceManager: { llmService },
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
}));

import { useCurrentModel } from "../use-current-model";

describe("useCurrentModel", () => {
	let modelListener!: (model: CurrentModelInfo | null) => void;

	beforeEach(() => {
		vi.clearAllMocks();
		llmService.clearCurrentModel.mockResolvedValue(undefined);
		llmService.onCurrentModelChange.mockImplementation(
			(listener: (model: CurrentModelInfo | null) => void) => {
				modelListener = listener;
				return vi.fn();
			},
		);
	});

	it("clears persisted model metadata when its authenticated service is unavailable", async () => {
		llmService.getCurrentModel.mockResolvedValue({
			modelId: "openrouter/model",
			provider: "openrouter",
			serviceName: "openrouter",
		});
		llmService.has.mockReturnValue(false);

		const { result } = renderHook(() => useCurrentModel());

		await waitFor(() => expect(result.current.isInitialized).toBe(true));
		expect(llmService.clearCurrentModel).toHaveBeenCalledTimes(1);
		expect(result.current.model).toBe("");
		expect(result.current.current).toBeNull();
	});

	it("keeps a restored model only when its service is ready", async () => {
		llmService.getCurrentModel.mockResolvedValue({
			modelId: "local/model",
			provider: "transformer",
			serviceName: "transformer",
		});
		llmService.has.mockReturnValue(true);

		const { result } = renderHook(() => useCurrentModel());

		await waitFor(() => expect(result.current.model).toBe("local/model"));
		expect(llmService.clearCurrentModel).not.toHaveBeenCalled();
		expect(result.current.current).toEqual({
			modelId: "local/model",
			provider: "transformer",
		});
	});

	it("removes an unavailable model received after initialization", async () => {
		llmService.getCurrentModel.mockResolvedValue(null);
		llmService.has.mockReturnValue(false);
		const { result } = renderHook(() => useCurrentModel());
		await waitFor(() => expect(result.current.isInitialized).toBe(true));

		act(() => {
			modelListener({
				modelId: "remote/model",
				provider: "openrouter",
				serviceName: "openrouter",
			});
		});

		await waitFor(() =>
			expect(llmService.clearCurrentModel).toHaveBeenCalledTimes(1),
		);
		expect(result.current.model).toBe("");
	});
});
