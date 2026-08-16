import { TRANSFORMER_MODELS } from "../configs/transformer-models";
import { WEBLLM_MODELS } from "../configs/webllm-models";
import { WLLAMA_MODELS } from "../configs/wllama-models";
import {
	getModelRunConfig,
	getQuickDownloadModelId,
	type LLMModelConfig,
	type LLMModelRunConfig,
	type LLMProvider,
	type ModelRuntimeProfile,
} from "../interfaces/llm-model-config";

export const ALL_MODELS: LLMModelConfig[] = [
	...TRANSFORMER_MODELS,
	...WEBLLM_MODELS,
	...WLLAMA_MODELS,
];

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase();
}

function toWllamaServeId(model: LLMModelConfig): string | null {
	if (model.provider !== "wllama" || !model.wllamaConfig?.filename) {
		return null;
	}

	return `${model.id}/${model.wllamaConfig.filename}`;
}

function modelIdsMatch(model: LLMModelConfig, candidateId: string): boolean {
	const candidate = normalizeModelId(candidateId);
	const direct = normalizeModelId(model.id);
	const modelLeaf = direct.split("/").pop() ?? direct;
	const candidateLeaf = candidate.split("/").pop() ?? candidate;
	return modelLeaf === candidateLeaf;
}

function modelIdMatchesExactly(
	model: LLMModelConfig,
	candidateId: string,
): boolean {
	const candidate = normalizeModelId(candidateId);
	if (candidate === normalizeModelId(model.id)) {
		return true;
	}

	const wllamaServeId = toWllamaServeId(model);
	return Boolean(
		wllamaServeId && candidate === normalizeModelId(wllamaServeId),
	);
}

export function getModel(
	modelId: string,
	provider?: LLMProvider,
): LLMModelConfig | undefined {
	const models = ALL_MODELS.filter((model) => {
		if (provider && model.provider !== provider) {
			return false;
		}

		return true;
	});

	return (
		models.find((model) => modelIdMatchesExactly(model, modelId)) ??
		models.find((model) => modelIdsMatch(model, modelId))
	);
}

export function getModelsByProvider(provider: LLMProvider): LLMModelConfig[] {
	return ALL_MODELS.filter((model) => model.provider === provider);
}

export function getSupportedModels(provider: LLMProvider): LLMModelConfig[] {
	return getModelsByProvider(provider).filter((model) => !model.unsupported);
}

export function getQuickDownloadModels(
	provider: LLMProvider,
): LLMModelConfig[] {
	return getSupportedModels(provider).filter((model) => model.quickDownload);
}

export function getModelRuntimeProfile(
	modelId: string,
	provider?: LLMProvider,
): ModelRuntimeProfile | undefined {
	const model = getModel(modelId, provider);
	if (!model) {
		return undefined;
	}

	return {
		provider: model.provider,
		modelId: model.id,
		sizeGB: model.sizeGB,
		contextLength: model.contextLength,
		requiresWebGPU: model.requiresWebGPU,
		kvBytesPerToken: model.kvBytesPerToken,
	};
}

export function getModelRunProfile(
	modelId: string,
	provider?: LLMProvider,
): LLMModelRunConfig | undefined {
	const model = getModel(modelId, provider);
	if (!model) {
		return undefined;
	}

	return getModelRunConfig(model);
}

export function getQuickDownloadModelEntry(
	modelId: string,
	provider?: LLMProvider,
): {
	id: string;
	model: string;
	repo?: string;
	filename?: string;
	size: string;
	description: string;
} | null {
	const model = getModel(modelId, provider);
	if (!model || !model.quickDownload || model.unsupported) {
		return null;
	}

	if (model.provider === "wllama") {
		return {
			id: getQuickDownloadModelId(model),
			model: model.id,
			repo: model.id,
			filename: model.wllamaConfig?.filename,
			size: model.sizeLabel,
			description: model.description,
		};
	}

	return {
		id: model.id,
		model: model.id,
		size: model.sizeLabel,
		description: model.description,
	};
}

export function getConfiguredWllamaFile(
	repoId: string,
): { name: string; size: number } | null {
	const model = getModel(repoId, "wllama");
	const filename = model?.wllamaConfig?.filename;
	if (!model || !filename) {
		return null;
	}

	return {
		name: filename,
		size: Math.round(model.sizeGB * 1024 ** 3),
	};
}
