import { describe, expect, it } from "vitest";
import { buildRunnerMemoryHint } from "../runner-memory-hints";
import type { SystemSpecs } from "@/main/modules/llm/types/system-specs";

const SPECS: SystemSpecs = {
	memoryGB: 32,
	cpuCores: 16,
	hasWebGPU: true,
	hasOpfs: true,
	gpu: { vendor: "nvidia", renderer: "RTX 5070", estimatedVRAM: 12 },
	deviceCategory: "ultra",
};

const CATALOGUED = "LiquidAI/LFM2.5-350M-GGUF";
const UNCATALOGUED = "someone/Custom-GGUF/custom-Q4_K_M.gguf";

describe("buildRunnerMemoryHint", () => {
	it("carries both budgets so the runner can size whichever backend it picks", async () => {
		const hint = await buildRunnerMemoryHint(CATALOGUED, "wllama", SPECS);

		expect(hint?.availableGB).toBeGreaterThan(0);
		expect(hint?.webgpuAvailableGB).toBe(12);
		expect(hint?.kvBytesPerToken).toBeGreaterThan(0);
		expect(hint?.contextLength).toBeGreaterThan(0);
	});

	it("still gives an uncatalogued model the device budget", async () => {
		// Without this, a custom Hugging Face repo had no budget to size a context
		// window against, so it asked for the ceiling and relied on the load
		// failing to find a size that fits. The runner fills in the model-specific
		// figures itself, from the GGUF header.
		const hint = await buildRunnerMemoryHint(UNCATALOGUED, "wllama", SPECS);

		expect(hint).toBeDefined();
		expect(hint?.availableGB).toBeGreaterThan(0);
		expect(hint?.webgpuAvailableGB).toBeGreaterThan(0);
		expect(hint?.kvBytesPerToken).toBeUndefined();
		expect(hint?.contextLength).toBeUndefined();
		expect(hint?.sizeGB).toBeUndefined();
	});

	it("gives nothing when there is no model or no device reading", async () => {
		expect(
			await buildRunnerMemoryHint(undefined, "wllama", SPECS),
		).toBeUndefined();
		expect(
			await buildRunnerMemoryHint(CATALOGUED, "wllama", null),
		).toBeUndefined();
	});
});
