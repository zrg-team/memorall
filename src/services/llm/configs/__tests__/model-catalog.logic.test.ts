import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { describe, expect, it } from "vitest";
import {
	ALL_MODELS,
	getConfiguredWllamaFile,
	getModel,
	getSupportedModels,
} from "../../registry/model-registry";
import { TRANSFORMER_MODELS } from "../transformer-models";
import { WEBLLM_MODELS } from "../webllm-models";
import { WLLAMA_MODELS } from "../wllama-models";

const TWO_GIB = 2 * 1024 ** 3;
const EXPECTED_CONTEXT_SCORES = new Map([
	[2048, 35],
	[4096, 50],
	[8192, 60],
	[32768, 85],
	[40960, 88],
]);

function sizeLabelToMiB(label: string): number {
	const match = label.match(/^~?([\d.]+)(MB|GB)$/);
	if (!match) {
		throw new Error(`Unsupported size label: ${label}`);
	}

	const value = Number(match[1]);
	return match[2] === "GB" ? value * 1024 : value;
}

describe("local LLM model catalog", () => {
	it("uses unique provider-qualified model IDs and valid metadata", () => {
		const keys = ALL_MODELS.map(
			(model) => `${model.provider}:${model.id.toLowerCase()}`,
		);
		expect(new Set(keys).size).toBe(keys.length);

		for (const model of ALL_MODELS) {
			expect(model.sizeGB).toBeGreaterThan(0);
			expect(model.contextLength).toBeGreaterThan(0);
			expect(model.defaultMaxNewTokens).toBeGreaterThan(0);
			expect(model.defaultMaxNewTokens).toBeLessThanOrEqual(
				model.contextLength,
			);
			expect(model.kvBytesPerToken).toBeGreaterThan(0);
		}
	});

	it("keeps enabled download labels consistent with configured byte sizes", () => {
		for (const model of ALL_MODELS.filter((entry) => !entry.unsupported)) {
			const configuredMiB = model.sizeGB * 1024;
			const labelledMiB = sizeLabelToMiB(model.sizeLabel);
			const toleranceMiB = Math.max(24, configuredMiB * 0.06);
			expect(
				Math.abs(configuredMiB - labelledMiB),
				`${model.provider}:${model.id}`,
			).toBeLessThanOrEqual(toleranceMiB);
		}
	});

	it("scores runtime contexts and budgets hybrid KV caches consistently", () => {
		for (const model of ALL_MODELS.filter((entry) => !entry.unsupported)) {
			const expectedScore =
				model.contextLength >= 128000
					? 98
					: EXPECTED_CONTEXT_SCORES.get(model.contextLength);
			if (expectedScore !== undefined) {
				expect(model.contextScore, `${model.provider}:${model.id}`).toBe(
					expectedScore,
				);
			}
		}

		expect(
			getModel("onnx-community/LFM2-1.2B-Tool-ONNX")?.kvBytesPerToken,
		).toBe(12_288);
		expect(
			getModel("LiquidAI/LFM2.5-2.6B-GGUF", "wllama")?.kvBytesPerToken,
		).toBe(16_384);
		expect(getModel("Qwen3.5-2B-q4f16_1-MLC", "webllm")?.kvBytesPerToken).toBe(
			12_288,
		);
		expect(
			getModel("HuggingFaceTB/SmolLM2-1.7B-Instruct", "transformer")
				?.kvBytesPerToken,
		).toBe(196_608);
	});

	it("charges each wllama model the KV cost its own GGUF header implies", () => {
		// These four sat at a placeholder 16_384 that was up to 8.5x too low, so
		// the sizer believed it could afford far more context than it could. Each
		// value below was read from the model's real GGUF header:
		// 2 (K+V) x layers x kv_heads x head_dim x 2 bytes (f16).
		const MEASURED: [string, number][] = [
			["ibm-granite/granite-4.0-350m-GGUF", 2 * 28 * 4 * 64 * 2],
			["bartowski/HuggingFaceTB_SmolLM3-3B-GGUF", 2 * 36 * 4 * 128 * 2],
			["unsloth/Llama-3.2-3B-Instruct-GGUF", 2 * 28 * 8 * 128 * 2],
			["unsloth/gemma-3-4b-it-GGUF", 2 * 34 * 4 * 256 * 2],
			// Already correct, and the reason the placeholders stood out: the same
			// model from another repo carried the right figure.
			["ggml-org/SmolLM3-3B-GGUF", 2 * 36 * 4 * 128 * 2],
			["unsloth/gemma-3-1b-it-GGUF", 2 * 26 * 1 * 256 * 2],
			["unsloth/gemma-3-270m-it-GGUF", 2 * 18 * 1 * 256 * 2],
		];

		for (const [id, expected] of MEASURED) {
			expect(getModel(id, "wllama")?.kvBytesPerToken, id).toBe(expected);
		}
	});

	it("matches every enabled WebLLM model to its compiled catalog entry", () => {
		const prebuiltModels = new Map(
			prebuiltAppConfig.model_list.map((model) => [model.model_id, model]),
		);

		for (const model of WEBLLM_MODELS.filter((entry) => !entry.unsupported)) {
			const prebuilt = prebuiltModels.get(model.id);
			expect(prebuilt, model.id).toBeDefined();
			expect(model.contextLength, model.id).toBe(
				prebuilt?.overrides?.context_window_size,
			);
			expect(model.defaultMaxNewTokens, model.id).toBe(model.contextLength / 4);
		}
	});

	it("keeps historical model IDs unsupported and exactly resolvable", () => {
		expect(
			getModel("onnx-community/SmolLM2-135M-Instruct", "transformer")
				?.unsupported,
		).toBe(true);
		expect(
			getModel("HuggingFaceTB/SmolLM2-135M-Instruct", "transformer")
				?.unsupported,
		).not.toBe(true);
		expect(
			getModel("TinyLlama-1.1B-Chat-v0.4-q0f16-MLC", "webllm")?.unsupported,
		).toBe(true);
		expect(
			getSupportedModels("webllm").some((model) => model.unsupported),
		).toBe(false);
	});

	it("pins supported wllama files below the single-file limit", () => {
		for (const model of WLLAMA_MODELS.filter((entry) => !entry.unsupported)) {
			expect(model.wllamaConfig?.filename, model.id).toBeTruthy();
			expect(model.sizeGB * 1024 ** 3, model.id).toBeLessThan(TWO_GIB);
		}

		expect(getConfiguredWllamaFile("prism-ml/Bonsai-1.7B-gguf")).toEqual({
			name: "Bonsai-1.7B-Q1_0.gguf",
			size: 248_302_272,
		});
		expect(getConfiguredWllamaFile("unsloth/Qwen3-4B-GGUF")?.name).toBe(
			"Qwen3-4B-Q3_K_S.gguf",
		);
		expect(
			getConfiguredWllamaFile("unsloth/Phi-4-mini-reasoning-GGUF")?.name,
		).toBe("Phi-4-mini-reasoning-Q3_K_S.gguf");
	});

	it("generates every Transformer runner configuration with explicit dtypes", () => {
		for (const model of TRANSFORMER_MODELS.filter(
			(entry) => !entry.unsupported,
		)) {
			expect(model.runnerConfig?.runtime, model.id).toBeTruthy();
			expect(model.runnerConfig?.dtype, model.id).toBeTruthy();
		}

		const generatedPath = fileURLToPath(
			new URL(
				"../../../../../public/runner/configs/transformer-model-configs.json",
				import.meta.url,
			),
		);
		const generated = JSON.parse(readFileSync(generatedPath, "utf8")) as {
			models: Array<{
				id: string;
				runnerConfig: { dtype?: string } | null;
			}>;
		};
		const generatedById = new Map(
			generated.models.map((model) => [model.id, model]),
		);

		expect(generated.models).toHaveLength(TRANSFORMER_MODELS.length);
		for (const model of TRANSFORMER_MODELS) {
			expect(generatedById.has(model.id), model.id).toBe(true);
			expect(generatedById.get(model.id)?.runnerConfig).toEqual(
				model.runnerConfig ?? null,
			);
		}
		expect(
			generatedById.get("onnx-community/Bonsai-1.7B-ONNX")?.runnerConfig?.dtype,
		).toBe("q1");
	});

	it("declares well-formed abilities on every supported model", () => {
		const toolModes = new Set(["native", "prompt_injection", "none"]);

		for (const model of ALL_MODELS.filter((entry) => !entry.unsupported)) {
			const label = `${model.provider}:${model.id}`;
			expect(model.abilities, `${label} is missing abilities`).toBeDefined();
			expect(toolModes.has(model.abilities.tools), `${label} tools`).toBe(true);
			expect(typeof model.abilities.vision, `${label} vision`).toBe("boolean");
			expect(typeof model.abilities.reasoning, `${label} reasoning`).toBe(
				"boolean",
			);
			expect(typeof model.abilities.multilingual, `${label} multilingual`).toBe(
				"boolean",
			);
		}
	});

	it("keeps WebLLM entries off native tools until the allowlist covers them", () => {
		// tool-capability-resolver.ts only grants native function calling to a
		// pinned Hermes allowlist, and no catalogued model is on it. Claiming
		// "native" here would promise the recommender something the runtime
		// cannot deliver.
		for (const model of getSupportedModels("webllm")) {
			expect(model.abilities.tools, `${model.id}`).not.toBe("native");
		}
	});

	it("marks vision on every model that ships a projector or a vision runtime", () => {
		for (const model of ALL_MODELS.filter((entry) => !entry.unsupported)) {
			const carriesVisionArtifacts =
				Boolean(model.wllamaConfig?.mmprojFilename) ||
				model.runnerConfig?.runtime === "image_text_to_text" ||
				model.runnerConfig?.runtime === "vision2seq";

			if (carriesVisionArtifacts) {
				expect(model.abilities.vision, `${model.provider}:${model.id}`).toBe(
					true,
				);
			}
		}
	});

	it("records a source alongside any quality evidence", () => {
		for (const model of ALL_MODELS) {
			if (!model.qualityEvidence) {
				continue;
			}
			const label = `${model.provider}:${model.id}`;
			expect(model.qualityEvidence.source, `${label} source`).toMatch(
				/^https?:/,
			);
			expect(model.qualityEvidence.recordedAt, `${label} recordedAt`).toMatch(
				/^\d{4}-\d{2}$/,
			);
			expect(
				Object.keys(model.qualityEvidence.scores).length,
				`${label} has an empty score set`,
			).toBeGreaterThan(0);
		}
	});
});
