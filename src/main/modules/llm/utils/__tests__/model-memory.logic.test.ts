import { describe, expect, it } from "vitest";

import {
	estimateModelMemory,
	estimateModelMemoryAtUsableContext,
	engineForProvider,
	estimateSafeTokenBudget,
	fitsStorageQuota,
	getAvailableModelMemoryGB,
	getModelMemoryBudget,
} from "../model-memory";

const GB = 1024 ** 3;

describe("getModelMemoryBudget", () => {
	const RICH_GPU = {
		deviceCategory: "ultra",
		memoryGB: 32,
		gpu: { estimatedVRAM: 24 },
		webgpuMaxAllocationBytes: 2 * GB,
	} as never;

	it("uses the limit the GPU reports for llama.cpp, which stops offloading at it", () => {
		// No browser API reports VRAM. maxStorageBufferBindingSize is the only
		// memory figure WebGPU guarantees, and llama.cpp's WebGPU backend both
		// reports it as free VRAM and stops offloading layers once it is spent —
		// so for that engine the per-buffer limit really is the whole budget.
		expect(getModelMemoryBudget(RICH_GPU, true, "llama.cpp")).toEqual({
			availableGB: 2,
			source: "gpu-allocation-limit",
		});
	});

	it("does not read that limit as a total for engines that spread across buffers", () => {
		// MLC and ONNX Runtime allocate many buffers, so the per-buffer cap bounds
		// one tensor, not the model. Treating it as the total would understate
		// them badly.
		expect(getModelMemoryBudget(RICH_GPU, true, "multi-buffer")).toEqual({
			availableGB: 24,
			source: "gpu-name-lookup",
		});
		// And that is the default, so a caller that has not thought about it gets
		// the conservative-in-the-right-direction answer.
		expect(getModelMemoryBudget(RICH_GPU, true)).toEqual(
			getModelMemoryBudget(RICH_GPU, true, "multi-buffer"),
		);
	});

	it("maps each provider to the engine it actually runs", () => {
		expect(engineForProvider("wllama")).toBe("llama.cpp");
		expect(engineForProvider("webllm")).toBe("multi-buffer");
		expect(engineForProvider("transformer")).toBe("multi-buffer");
	});

	it("falls back to the GPU name table, then to the device class", () => {
		expect(
			getModelMemoryBudget(
				{
					deviceCategory: "high",
					memoryGB: 32,
					gpu: { estimatedVRAM: 10 },
				} as never,
				true,
			),
		).toEqual({ availableGB: 10, source: "gpu-name-lookup" });

		// An RTX 5070 misses the hand-kept table entirely, which is exactly how a
		// current card ends up here.
		expect(
			getModelMemoryBudget(
				{ deviceCategory: "medium", memoryGB: 16 } as never,
				true,
			),
		).toEqual({ availableGB: 4, source: "device-class-guess" });
	});

	it("uses a share of system RAM for CPU models", () => {
		expect(
			getModelMemoryBudget(
				{ deviceCategory: "medium", memoryGB: 16 } as never,
				false,
			),
		).toEqual({ availableGB: 6.4, source: "system-ram" });
	});

	it("never lets the GPU allocation limit bleed into the CPU budget", () => {
		const budget = getModelMemoryBudget(
			{
				deviceCategory: "ultra",
				memoryGB: 32,
				webgpuMaxAllocationBytes: 2 * GB,
			} as never,
			false,
			"llama.cpp",
		);

		expect(budget.source).toBe("system-ram");
		expect(budget.availableGB).toBe(12.8);
	});
});

describe("fitsStorageQuota", () => {
	it("rejects weights larger than the origin can store", () => {
		const specs = { storageQuotaBytes: 10 * GB } as never;

		expect(fitsStorageQuota(specs, 4)).toEqual({ fits: true, quotaGB: 10 });
		expect(fitsStorageQuota(specs, 12)).toEqual({ fits: false, quotaGB: 10 });
	});

	it("does not block a download when the quota is unknown", () => {
		expect(fitsStorageQuota({} as never, 40)).toEqual({ fits: true });
	});
});

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

describe("estimateModelMemoryAtUsableContext", () => {
	it("reports fit at the context the device can actually reach", () => {
		// 2 GB weights, 128K advertised context, 8 GB budget: the full context
		// overflows, but the model is comfortable at the context it can reach.
		const atFull = estimateModelMemory(2, 196_608, 128_000, 8);
		expect(atFull.fit).toBe("overflow");

		// 2 GB of weights against an 8 GB budget is comfortable; only the KV
		// cache for the full 128K was ever the problem.
		const usable = estimateModelMemoryAtUsableContext(2, 196_608, 128_000, 8);
		expect(usable.fit).toBe("comfortable");
		// The advertised-vs-achievable gap is still reported to the caller.
		expect(usable.feasibleContext).toBe(atFull.feasibleContext);
		expect(usable.feasibleContext).toBeLessThan(128_000);
	});

	it("still reports overflow when the weights alone do not fit", () => {
		expect(estimateModelMemoryAtUsableContext(20, 1024, 8192, 8).fit).toBe(
			"overflow",
		);
	});

	it("is a passthrough when the full context already fits", () => {
		expect(estimateModelMemoryAtUsableContext(2, 1024, 2048, 8)).toEqual(
			estimateModelMemory(2, 1024, 2048, 8),
		);
	});
});
