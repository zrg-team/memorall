import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { modelsFor } = vi.hoisted(() => ({ modelsFor: vi.fn() }));

vi.mock("@/services", () => ({
	serviceManager: { llmService: { modelsFor } },
}));

import { useStudioModelInfo } from "../use-studio-model-info";

const MODEL = {
	modelId: "org/decider",
	provider: "transformer-media",
	serviceName: "transformer-media",
} as const;

const listing = (...ids: string[]) => ({
	object: "list",
	data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "x" })),
});

describe("useStudioModelInfo", () => {
	afterEach(() => {
		vi.useRealTimers();
		modelsFor.mockReset();
	});

	it("asks again while a just-picked model is not listed yet", async () => {
		vi.useFakeTimers();
		modelsFor
			.mockResolvedValueOnce(listing("org/other"))
			.mockResolvedValueOnce(listing("org/other", "org/decider"));

		const { result } = renderHook(() => useStudioModelInfo({ ...MODEL }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(result.current).toBeUndefined();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});
		expect(result.current?.id).toBe("org/decider");
		expect(modelsFor).toHaveBeenCalledTimes(2);
	});

	it("gives up after a few tries", async () => {
		vi.useFakeTimers();
		modelsFor.mockResolvedValue(listing("org/other"));

		const { result } = renderHook(() => useStudioModelInfo({ ...MODEL }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60_000);
		});
		expect(result.current).toBeUndefined();
		expect(modelsFor).toHaveBeenCalledTimes(11);
	});
});
