import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityId } from "@/platform/contracts/core";

const capabilities = new Map<CapabilityId, boolean>();

vi.mock("@/platform/current", () => ({
	platform: {
		capabilities: {
			get: (id: CapabilityId) => ({
				available: capabilities.get(id) ?? false,
			}),
		},
	},
}));

const loadModule = async () => import("../browser-support");

beforeEach(() => {
	capabilities.clear();
	capabilities.set("ai.webgpu", true);
	capabilities.set("storage.opfs", true);
});

describe("provider browser support", () => {
	it("treats remote providers as always available", async () => {
		const { getProviderSupport } = await loadModule();
		capabilities.set("ai.webgpu", false);
		capabilities.set("storage.opfs", false);

		for (const provider of ["openai", "openrouter", "ollama"] as const) {
			expect(getProviderSupport(provider)).toEqual({ supported: true });
		}
	});

	it("reports WebLLM as unsupported without WebGPU", async () => {
		const { getProviderSupport } = await loadModule();
		capabilities.set("ai.webgpu", false);

		expect(getProviderSupport("webllm")).toEqual({
			supported: false,
			reason: "webgpu",
		});
		// Wllama is CPU-based, so it survives a missing GPU.
		expect(getProviderSupport("wllama")).toEqual({ supported: true });
	});

	it("reports Wllama as unsupported without the private file system", async () => {
		const { getProviderSupport } = await loadModule();
		capabilities.set("storage.opfs", false);

		expect(getProviderSupport("wllama")).toEqual({
			supported: false,
			reason: "opfs",
		});
		expect(getProviderSupport("webllm")).toEqual({ supported: true });
	});

	it("keeps Transformers.js available, since it falls back to WASM", async () => {
		const { getProviderSupport } = await loadModule();
		capabilities.set("ai.webgpu", false);
		capabilities.set("storage.opfs", false);

		expect(getProviderSupport("transformer")).toEqual({ supported: true });
	});

	it("lists only the local providers this browser can run", async () => {
		const { getSupportedLocalProviders } = await loadModule();
		capabilities.set("ai.webgpu", false);

		expect(getSupportedLocalProviders()).toEqual(["transformer", "wllama"]);
	});

	it("has no on-device models when neither WebGPU nor OPFS exist", async () => {
		const { hasLocalModelSupport } = await loadModule();

		expect(hasLocalModelSupport()).toBe(true);
		capabilities.set("ai.webgpu", false);
		expect(hasLocalModelSupport()).toBe(true);
		capabilities.set("storage.opfs", false);
		expect(hasLocalModelSupport()).toBe(false);
		capabilities.set("ai.webgpu", true);
		expect(hasLocalModelSupport()).toBe(true);
	});
});
