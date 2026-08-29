import { describe, expect, it } from "vitest";
import {
	CONTEXT_GRANULARITY,
	LIMITED_BY,
	planContextFromMemoryHint,
	planContextWindow,
	RUNTIME_OVERHEAD,
	WASM32_ADDRESS_SPACE_BYTES,
} from "../../../../../public/runner/utils/context-planner.js";

const GB = 1024 ** 3;

/** A 1B-ish model: 32 layers × 8 KV heads × 128 dim × 2 (K+V) × 2 bytes. */
const KV_PER_TOKEN = 32 * 8 * 128 * 2 * 2;

describe("planContextWindow", () => {
	it("spends the memory left after weights on KV cache", () => {
		const plan = planContextWindow({
			weightsBytes: 1 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 8 * GB,
		});

		const forKV = 8 / RUNTIME_OVERHEAD - 1;
		const expected =
			Math.floor((forKV * GB) / KV_PER_TOKEN / CONTEXT_GRANULARITY) *
			CONTEXT_GRANULARITY;
		expect(plan.contextTokens).toBe(expected);
		expect(plan.limitedBy).toBe(LIMITED_BY.MEMORY);
		expect(plan.fits).toBe(true);
	});

	it("never exceeds the context the model was trained for", () => {
		const plan = planContextWindow({
			weightsBytes: 0.2 * GB,
			kvBytesPerToken: 4096,
			budgetBytes: 64 * GB,
			trainedContext: 8192,
		});

		expect(plan.contextTokens).toBe(8192);
		expect(plan.limitedBy).toBe(LIMITED_BY.TRAINED);
	});

	it("respects the product ceiling", () => {
		const plan = planContextWindow({
			weightsBytes: 0.2 * GB,
			kvBytesPerToken: 4096,
			budgetBytes: 64 * GB,
			trainedContext: 1_000_000,
			ceiling: 65536,
		});

		expect(plan.contextTokens).toBe(65536);
		expect(plan.limitedBy).toBe(LIMITED_BY.CEILING);
	});

	it("caps a wasm32 heap at 4 GiB no matter how much RAM the machine has", () => {
		// WebGPU never sees this ceiling; the wasm heap always does when the
		// browser lacks MEMORY64 (Safari, and wllama's compat mode).
		const roomy = planContextWindow({
			weightsBytes: 1 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 64 * GB,
		});
		const confined = planContextWindow({
			weightsBytes: 1 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 64 * GB,
			addressSpaceBytes: WASM32_ADDRESS_SPACE_BYTES,
		});

		expect(confined.contextTokens).toBeLessThan(roomy.contextTokens);
		expect(confined.limitedBy).toBe(LIMITED_BY.ADDRESS_SPACE);
	});

	it("respects the WebGPU per-buffer limit, which is all WebGPU exposes", () => {
		// Measured on an RTX 5070: maxStorageBufferBindingSize is 2 GB even though
		// the card has 12 GB, and llama.cpp reports that same number as free VRAM.
		const layerCount = 32;
		const unclamped = planContextWindow({
			weightsBytes: 0.5 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 12 * GB,
			layerCount,
		});
		const clamped = planContextWindow({
			weightsBytes: 0.5 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 12 * GB,
			layerCount,
			maxAllocationBytes: 64 * 1024 * 1024,
		});

		expect(clamped.contextTokens).toBeLessThan(unclamped.contextTokens);
		expect(clamped.limitedBy).toBe(LIMITED_BY.ALLOCATION);
		// The per-layer KV block must fit inside one buffer.
		const perLayerBytes = (clamped.contextTokens * KV_PER_TOKEN) / layerCount;
		expect(perLayerBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
	});

	it("reports that a model whose weights exceed the budget does not fit", () => {
		const plan = planContextWindow({
			weightsBytes: 10 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 4 * GB,
		});

		expect(plan.fits).toBe(false);
		expect(plan.contextTokens).toBe(0);
		expect(plan.limitedBy).toBe(LIMITED_BY.DOES_NOT_FIT);
	});

	it("blames the address space when that is what made the model not fit", () => {
		const plan = planContextWindow({
			weightsBytes: 6 * GB,
			kvBytesPerToken: KV_PER_TOKEN,
			budgetBytes: 32 * GB,
			addressSpaceBytes: WASM32_ADDRESS_SPACE_BYTES,
		});

		expect(plan.fits).toBe(false);
		expect(plan.limitedBy).toBe(LIMITED_BY.ADDRESS_SPACE);
	});

	it("falls back to the ceiling when it has nothing to size with", () => {
		const plan = planContextWindow({ ceiling: 65536 });

		expect(plan.contextTokens).toBe(65536);
		expect(plan.limitedBy).toBe(LIMITED_BY.UNKNOWN);
	});

	it("quotes windows in whole 1K steps", () => {
		const plan = planContextWindow({
			weightsBytes: 0,
			kvBytesPerToken: 12345,
			budgetBytes: 3 * GB,
		});

		expect(plan.contextTokens % CONTEXT_GRANULARITY).toBe(0);
	});
});

describe("planContextFromMemoryHint", () => {
	const hint = {
		availableGB: 8,
		webgpuAvailableGB: 2,
		sizeGB: 0.5,
		kvBytesPerToken: KV_PER_TOKEN,
		contextLength: 32768,
		usesWebGPU: false,
	};

	it("sizes against whichever budget the backend actually uses", () => {
		const cpu = planContextFromMemoryHint(hint);
		const gpu = planContextFromMemoryHint(hint, {
			budgetGB: hint.webgpuAvailableGB,
		});

		expect(gpu?.contextTokens).toBeLessThan(cpu?.contextTokens ?? 0);
	});

	it("prefers a measured KV cost over the catalogue's figure", () => {
		const measured = planContextFromMemoryHint(hint, {
			kvBytesPerToken: KV_PER_TOKEN * 4,
		});
		const catalogued = planContextFromMemoryHint(hint);

		expect(measured?.contextTokens).toBeLessThan(
			catalogued?.contextTokens ?? 0,
		);
	});

	it("prefers a measured trained context over the catalogue's", () => {
		const plan = planContextFromMemoryHint(hint, { trainedContext: 4096 });

		expect(plan?.contextTokens).toBe(4096);
		expect(plan?.limitedBy).toBe(LIMITED_BY.TRAINED);
	});

	it("returns nothing when the hint carries no usable numbers", () => {
		expect(planContextFromMemoryHint(undefined)).toBeUndefined();
		expect(planContextFromMemoryHint({ availableGB: 8 })).toBeUndefined();
		expect(
			planContextFromMemoryHint({ kvBytesPerToken: 1024 }),
		).toBeUndefined();
	});

	it("prefers a measured weight size over the catalogue's", () => {
		const plan = planContextFromMemoryHint(hint, {
			weightsBytes: 6 * GB,
		});
		const catalogued = planContextFromMemoryHint(hint);

		expect(plan?.contextTokens).toBeLessThan(catalogued?.contextTokens ?? 0);
	});

	it("can size a model the catalogue knows nothing about, from measurements alone", () => {
		// The whole point of the GGUF probe: no hint fields but availableGB, yet a
		// real window comes out.
		const plan = planContextFromMemoryHint(
			{ availableGB: 8 },
			{ kvBytesPerToken: KV_PER_TOKEN, trainedContext: 16384 },
		);

		expect(plan?.fits).toBe(true);
		expect(plan?.contextTokens).toBeGreaterThan(0);
	});
});
