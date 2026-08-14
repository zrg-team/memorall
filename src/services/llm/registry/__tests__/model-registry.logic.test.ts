import { describe, expect, it } from "vitest";
import { getConfiguredWllamaFile, getModel } from "../model-registry";

describe("Wllama model registry", () => {
	it("pins the projector used by the local-model acceptance fixture", () => {
		const model = getModel(
			"LiquidAI/LFM2-VL-450M-GGUF/LFM2-VL-450M-Q4_0.gguf",
			"wllama",
		);

		expect(model?.wllamaConfig).toEqual({
			filename: "LFM2-VL-450M-Q4_0.gguf",
			mmprojFilename: "mmproj-LFM2-VL-450M-Q8_0.gguf",
		});
	});

	it("uses the configured GGUF file without repository discovery", () => {
		expect(getConfiguredWllamaFile("LiquidAI/LFM2-VL-450M-GGUF")).toEqual({
			name: "LFM2-VL-450M-Q4_0.gguf",
			size: Math.round(0.26 * 1024 ** 3),
		});
		expect(getConfiguredWllamaFile("owner/unregistered-model")).toBeNull();
	});
});
