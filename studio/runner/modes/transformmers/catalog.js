import {
	DEFAULT_MAX_NEW_TOKENS,
	DEFAULT_TRANSFORMER_DTYPE,
} from "./constants.js";

let transformerRunnerCatalogPromise = null;
let MODEL_RUNTIME_CONFIGS = new Map();
let UNSUPPORTED_BROWSER_MODELS = new Map();
let KNOWN_TRANSFORMER_MODEL_IDS = new Set();

function getTransformerRunnerConfigsUrl() {
	return new URL("../../configs/transformer-model-configs.json", import.meta.url);
}

export async function ensureTransformerRunnerCatalog() {
	if (transformerRunnerCatalogPromise) {
		return transformerRunnerCatalogPromise;
	}

	transformerRunnerCatalogPromise = (async () => {
		const response = await fetch(getTransformerRunnerConfigsUrl());
		if (!response.ok) {
			throw new Error(
				`Failed to load transformer model configs: ${response.status} ${response.statusText}`,
			);
		}

		const payload = await response.json();
		const runtimeConfigs = new Map();
		const unsupportedModels = new Map();
		const knownModelIds = new Set();

		for (const model of payload?.models ?? []) {
			if (!model?.id) continue;

			knownModelIds.add(model.id);

			if (typeof model.unsupportedReason === "string" && model.unsupportedReason) {
				unsupportedModels.set(model.id, model.unsupportedReason);
				continue;
			}

			const runnerConfig = model.runnerConfig ?? {};
			runtimeConfigs.set(model.id, {
				runtime: runnerConfig.runtime ?? "causal_lm",
				dtype: runnerConfig.dtype ?? DEFAULT_TRANSFORMER_DTYPE,
				...(runnerConfig.moduleDtype &&
				typeof runnerConfig.moduleDtype === "object"
					? { moduleDtype: runnerConfig.moduleDtype }
					: {}),
				...(typeof runnerConfig.postprocess === "string"
					? { postprocess: runnerConfig.postprocess }
					: {}),
				...(typeof runnerConfig.processorMode === "string"
					? { processorMode: runnerConfig.processorMode }
					: {}),
				...(typeof runnerConfig.modelClassFallback === "string"
					? { modelClassFallback: runnerConfig.modelClassFallback }
					: {}),
				defaultMaxNewTokens:
					model.defaultMaxNewTokens ?? DEFAULT_MAX_NEW_TOKENS,
				...(typeof runnerConfig.webgpuMaxContextTokens === "number"
					? { webgpuMaxContextTokens: runnerConfig.webgpuMaxContextTokens }
					: {}),
			});
		}

		MODEL_RUNTIME_CONFIGS = runtimeConfigs;
		UNSUPPORTED_BROWSER_MODELS = unsupportedModels;
		KNOWN_TRANSFORMER_MODEL_IDS = knownModelIds;
	})();

	try {
		await transformerRunnerCatalogPromise;
	} catch (error) {
		transformerRunnerCatalogPromise = null;
		throw error;
	}
}

export function getModelRuntimeConfig(modelId) {
	return (
		MODEL_RUNTIME_CONFIGS.get(modelId) ?? {
			runtime: "causal_lm",
			dtype: "auto",
			defaultMaxNewTokens: DEFAULT_MAX_NEW_TOKENS,
		}
	);
}

export function getUnsupportedBrowserModelMessage(modelId) {
	return UNSUPPORTED_BROWSER_MODELS.get(modelId);
}

export function getKnownTransformerModelIds() {
	return KNOWN_TRANSFORMER_MODEL_IDS;
}

export function isKnownTransformerLLMModelId(modelId) {
	return Boolean(modelId) && KNOWN_TRANSFORMER_MODEL_IDS.has(modelId);
}
