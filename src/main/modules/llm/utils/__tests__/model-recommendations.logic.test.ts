import { describe, expect, it, vi } from "vitest";
import type { LLMModelConfig } from "@/services/llm/interfaces/llm-model-config";
import type { SystemSpecs } from "../../types/system-specs";

const mocks = vi.hoisted(() => ({ models: [] as LLMModelConfig[] }));

vi.mock("@/services/llm/registry/model-registry", () => ({
	get ALL_MODELS() {
		return mocks.models;
	},
	getModelRunProfile: (id: string, provider: string) => ({
		provider,
		model: id,
	}),
}));

import {
	generateAllRecommendations,
	generateRecommendations,
} from "../model-recommendations";

const WEBGPU_SPECS: SystemSpecs = {
	memoryGB: 8,
	cpuCores: 8,
	hasWebGPU: true,
	deviceCategory: "high",
};

/** A small, comfortably-fitting model; override per test. */
function model(overrides: Partial<LLMModelConfig> = {}): LLMModelConfig {
	return {
		id: `test/${overrides.displayName ?? "model"}`,
		provider: "transformer",
		displayName: "Model",
		sizeGB: 0.5,
		sizeLabel: "500MB",
		description: "test model",
		contextLength: 32768,
		defaultMaxNewTokens: 1024,
		kvBytesPerToken: 12_288,
		requiresWebGPU: true,
		minMemoryGB: 2,
		qualityScore: 70,
		performanceScore: 70,
		contextScore: 85,
		abilities: {
			tools: "prompt_injection",
			vision: false,
			reasoning: false,
			multilingual: false,
		},
		releaseDate: "2025-06",
		runnerConfig: { runtime: "causal_lm", dtype: "auto" },
		...overrides,
	};
}

function rank(preference: Parameters<typeof generateRecommendations>[1]) {
	return generateRecommendations(WEBGPU_SPECS, preference, 50).map(
		(recommendation) => recommendation.displayName,
	);
}

describe("model recommendations", () => {
	it("prefers a tool-capable model over an equal one without tools", () => {
		mocks.models = [
			model({ displayName: "NoTools", id: "test/a" }),
			model({
				displayName: "NativeTools",
				id: "test/b",
				abilities: {
					tools: "native",
					vision: false,
					reasoning: false,
					multilingual: false,
				},
			}),
		];

		// Identical on every scored axis except abilities, so tools decides.
		expect(rank("quality")[0]).toBe("NativeTools");
		expect(rank("performance")[0]).toBe("NativeTools");
	});

	it("does not let tool support override a large quality gap", () => {
		mocks.models = [
			model({ displayName: "WeakButTooled", id: "test/a", qualityScore: 40 }),
			model({ displayName: "StrongNoTools", id: "test/b", qualityScore: 90 }),
		];
		mocks.models[0].abilities.tools = "native";
		mocks.models[1].abilities.tools = "none";

		// 50 quality points doubled to 100 dwarfs the 8-point tool bonus.
		expect(rank("quality")[0]).toBe("StrongNoTools");
	});

	it("balance prefers an even model over a spiky one", () => {
		mocks.models = [
			model({
				displayName: "Spiky",
				id: "test/a",
				qualityScore: 99,
				performanceScore: 30,
				contextScore: 35,
				contextLength: 2048,
			}),
			model({
				displayName: "Even",
				id: "test/b",
				qualityScore: 75,
				performanceScore: 75,
				contextScore: 85,
			}),
		];

		expect(rank("balance")[0]).toBe("Even");
		// The spiky model still wins the axis it is actually good at.
		expect(rank("quality")[0]).toBe("Spiky");
	});

	it("does not let a WebLLM context cap sink an otherwise strong model", () => {
		// Regression: MLC pins contextLength to 4096, so contextScore is 50 for
		// nearly every WebLLM entry. With an unweighted geometric mean a weak
		// long-context model outranked a strong short-context one on "balance".
		mocks.models = [
			model({
				displayName: "WeakLongContext",
				id: "test/a",
				provider: "transformer",
				qualityScore: 40,
				performanceScore: 98,
				contextScore: 98,
				contextLength: 128000,
			}),
			model({
				displayName: "StrongCappedContext",
				id: "test/b",
				provider: "webllm",
				qualityScore: 77,
				performanceScore: 88,
				contextScore: 50,
				contextLength: 4096,
			}),
		];

		expect(rank("balance")[0]).toBe("StrongCappedContext");
	});

	it("keeps recency from burying a much better older model", () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

		mocks.models = [
			model({
				displayName: "BrandNewMediocre",
				id: "test/a",
				qualityScore: 60,
				releaseDate: thisMonth,
			}),
			model({
				displayName: "OlderExcellent",
				id: "test/b",
				qualityScore: 90,
				releaseDate: "2024-01",
			}),
		];

		// 30 quality points doubled to 60 beats the 12-point recency window.
		expect(rank("quality")[0]).toBe("OlderExcellent");
	});

	it("still breaks near-ties in favour of the newer model", () => {
		const now = new Date();
		const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

		mocks.models = [
			model({
				displayName: "New",
				id: "test/a",
				qualityScore: 70,
				releaseDate: thisMonth,
			}),
			model({
				displayName: "Old",
				id: "test/b",
				qualityScore: 70,
				releaseDate: "2024-01",
			}),
		];

		expect(rank("quality")[0]).toBe("New");
	});

	it("collapses the same model catalogued under several runtimes", () => {
		mocks.models = [
			model({
				displayName: "Qwen 3 1.7B",
				id: "a/qwen",
				provider: "transformer",
			}),
			model({ displayName: "Qwen 3 1.7B", id: "b/qwen", provider: "webllm" }),
			model({
				displayName: "Qwen 3 1.7B",
				id: "c/qwen",
				provider: "wllama",
				requiresWebGPU: false,
			}),
			model({ displayName: "Gemma 3 1B", id: "d/gemma" }),
		];

		expect(rank("quality")).toEqual(["Qwen 3 1.7B", "Gemma 3 1B"]);
	});

	it("excludes models that cannot hold a usable context", () => {
		mocks.models = [
			model({ displayName: "Fits", id: "test/a" }),
			// Weights alone exceed the 8 GB WebGPU budget for deviceCategory "high".
			model({ displayName: "TooBig", id: "test/b", sizeGB: 20 }),
		];

		expect(rank("quality")).toEqual(["Fits"]);
	});

	it("drops WebGPU-only models on a device without WebGPU", () => {
		mocks.models = [
			model({ displayName: "GpuOnly", id: "test/a", requiresWebGPU: true }),
			model({
				displayName: "CpuOk",
				id: "test/b",
				requiresWebGPU: false,
				provider: "wllama",
			}),
		];

		const cpuOnly: SystemSpecs = {
			...WEBGPU_SPECS,
			hasWebGPU: false,
			deviceCategory: "medium",
		};
		const names = generateRecommendations(cpuOnly, "quality", 50).map(
			(r) => r.displayName,
		);
		expect(names).toEqual(["CpuOk"]);
	});

	it("returns a primary and alternatives for every preference", () => {
		mocks.models = [
			model({ displayName: "A", id: "test/a" }),
			model({ displayName: "B", id: "test/b", qualityScore: 60 }),
		];

		const set = generateAllRecommendations(WEBGPU_SPECS);
		expect(set).not.toBeNull();
		for (const preference of [
			"performance",
			"balance",
			"quality",
			"context",
		] as const) {
			expect(set?.[preference].primary).toBeDefined();
			expect(set?.[preference].alternatives).toHaveLength(1);
		}
	});

	it("returns null when nothing is compatible", () => {
		mocks.models = [model({ displayName: "TooBig", id: "test/a", sizeGB: 40 })];
		expect(generateAllRecommendations(WEBGPU_SPECS)).toBeNull();
	});

	it("surfaces abilities on the recommendation so the UI can badge them", () => {
		mocks.models = [
			model({
				displayName: "Tooled",
				id: "test/a",
				abilities: {
					tools: "native",
					vision: true,
					reasoning: true,
					multilingual: true,
				},
			}),
		];

		expect(
			generateRecommendations(WEBGPU_SPECS, "quality", 1)[0].abilities,
		).toEqual({
			tools: "native",
			vision: true,
			reasoning: true,
			multilingual: true,
		});
	});
});
