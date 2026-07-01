import { describe, expect, it } from "vitest";

import {
	estimateModelMemory,
	estimateSafeTokenBudget,
	getAvailableModelMemoryGB,
} from "../model-memory";

describe("LLM model memory utilities", () => {
	it("uses VRAM for WebGPU and a conservative RAM fraction for CPU", () => {
		expect(
			getAvailableModelMemoryGB(
				{
					deviceCategory: "high",
					memoryGB: 32,
					gpu: { estimatedVRAM: 10 },
				} as any,
				true,
			),
		).toBe(10);
		expect(
			getAvailableModelMemoryGB(
				{ deviceCategory: "medium", memoryGB: 16 } as any,
				true,
			),
		).toBe(4);
		expect(
			getAvailableModelMemoryGB(
				{ deviceCategory: "medium", memoryGB: 16 } as any,
				false,
			),
		).toBe(6.4);
	});

	it("estimates model memory fit and feasible context", () => {
		expect(estimateModelMemory(2, 1024, 2048, 8)).toEqual(
			expect.objectContaining({
				weightsGB: 2,
				feasibleContext: 2048,
				fit: "comfortable",
			}),
		);
		expect(estimateModelMemory(20, 1024, 8192, 8)).toEqual(
			expect.objectContaining({
				feasibleContext: 0,
				fit: "overflow",
			}),
		);
	});

	it("estimates safe token budgets from memory and context limits", () => {
		expect(
			estimateSafeTokenBudget({
				promptTokens: 1000,
				sizeGB: 2,
				kvBytesPerToken: 2048,
				availableGB: 8,
				maxContextTokens: 4096,
			}),
		).toEqual({
			maxTotalContextTokens: 4096,
			maxNewTokens: 3096,
			maxNewTokensByMemory: 3096,
			maxNewTokensByContext: 3096,
		});
		expect(
			estimateSafeTokenBudget({
				promptTokens: 500,
				sizeGB: 20,
				kvBytesPerToken: 2048,
				availableGB: 8,
			}).maxNewTokensByMemory,
		).toBe(0);
	});
});
