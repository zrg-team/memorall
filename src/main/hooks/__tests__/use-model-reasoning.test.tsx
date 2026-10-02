import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelReasoning } from "@/services/llm/interfaces/base-llm";
import type { ReasoningEffort } from "@/types/openai";

const mocks = vi.hoisted(() => ({
	stored: {} as Record<string, unknown>,
	efforts: {} as Record<string, ReasoningEffort | undefined>,
	setEffort: vi.fn(),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: vi.fn(async (key: string) => mocks.stored[key] ?? null),
			set: vi.fn(async (key: string, value: unknown) => {
				mocks.stored[key] = value;
			}),
		},
	},
}));

vi.mock("@/services/llm/reasoning-effort-settings", () => ({
	reasoningEffortKey: (model: { provider: string; modelId: string }) =>
		`${model.provider}:${model.modelId}`,
	reasoningEffortSettings: {
		get: vi.fn(async (key: string) => mocks.efforts[key]),
		set: mocks.setEffort,
		subscribe: vi.fn(() => () => undefined),
	},
}));

vi.mock("@/utils/logger", () => ({ logWarn: vi.fn() }));

import {
	MODEL_REASONING_STORAGE_KEY,
	useModelReasoning,
} from "../use-model-reasoning";
import { useReasoningEffort } from "../use-reasoning-effort";

const current = { provider: "openrouter" as const, modelId: "z-ai/glm" };
const glm: ModelReasoning = {
	efforts: ["low", "high", "max"],
	defaultEffort: "max",
	mandatory: true,
};

describe("useModelReasoning", () => {
	beforeEach(() => {
		mocks.stored = {};
	});

	it("offers the controls listed last time before the model list loads", async () => {
		mocks.stored[MODEL_REASONING_STORAGE_KEY] = { "openrouter:z-ai/glm": glm };

		const { result } = renderHook(() => useModelReasoning(current, undefined));

		await waitFor(() => expect(result.current).toEqual(glm));
	});

	it("follows the list once it has the model, and remembers what it says", async () => {
		const listed = { reasoning: { efforts: ["low"] } as ModelReasoning };

		const { result } = renderHook(() => useModelReasoning(current, listed));

		expect(result.current).toEqual(listed.reasoning);
		await waitFor(() =>
			expect(mocks.stored[MODEL_REASONING_STORAGE_KEY]).toEqual({
				"openrouter:z-ai/glm": listed.reasoning,
			}),
		);
	});
});

describe("useReasoningEffort", () => {
	beforeEach(() => {
		mocks.efforts = {};
		mocks.setEffort.mockReset().mockResolvedValue(undefined);
	});

	it("shows the saved level at once and keeps it while the list is loading", async () => {
		mocks.efforts["openrouter:z-ai/glm"] = "low";

		const { result } = renderHook(() => useReasoningEffort(current, undefined));

		await waitFor(() => expect(result.current[0]).toBe("low"));
		expect(mocks.setEffort).not.toHaveBeenCalled();
	});

	it("drops a saved level the listed model does not accept", async () => {
		mocks.efforts["openrouter:z-ai/glm"] = "medium";

		const { result } = renderHook(() =>
			useReasoningEffort(current, ["low", "high", "max"]),
		);

		await waitFor(() =>
			expect(mocks.setEffort).toHaveBeenCalledWith(
				"openrouter:z-ai/glm",
				undefined,
			),
		);
		expect(result.current[0]).toBeUndefined();
	});
});
