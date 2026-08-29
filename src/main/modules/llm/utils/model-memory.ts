import type { SystemSpecs } from "../types/system-specs";

export interface ModelMemoryEstimate {
	weightsGB: number;
	kvCacheGB: number;
	bufferGB: number;
	totalGB: number;
	/** Max total context tokens that fit in available memory */
	feasibleContext: number;
	fit: "comfortable" | "tight" | "overflow";
}

export interface TokenBudgetEstimate {
	maxTotalContextTokens?: number;
	maxNewTokens?: number;
	maxNewTokensByMemory?: number;
	maxNewTokensByContext?: number;
}

const WEBGPU_MEMORY_BY_CATEGORY: Record<SystemSpecs["deviceCategory"], number> =
	{
		ultra: 12,
		high: 8,
		medium: 4,
		low: 2,
	};

const CPU_AI_MEMORY_FRACTION = 0.4;
const RUNTIME_BUFFER_MULTIPLIER = 1.2;
const CONTEXT_GRANULARITY = 1024;

/** Where a memory budget's figure came from, so the UI can be honest about it. */
export type MemoryBudgetSource =
	| "gpu-allocation-limit"
	| "gpu-name-lookup"
	| "device-class-guess"
	| "system-ram";

export interface MemoryBudget {
	availableGB: number;
	source: MemoryBudgetSource;
}

/**
 * How the engine behind a model allocates GPU memory, which decides whether the
 * per-buffer limit bounds the whole model or just one tensor.
 */
export type InferenceEngine = "llama.cpp" | "multi-buffer";

/** wllama is llama.cpp; WebLLM (MLC) and Transformers.js (ORT) are not. */
export function engineForProvider(provider: string): InferenceEngine {
	return provider === "wllama" ? "llama.cpp" : "multi-buffer";
}

/**
 * The effective memory budget for weights plus KV cache, and where it came from.
 *
 * No browser API reports VRAM — WebGPU withholds it as a fingerprinting vector,
 * and probing it by allocating until failure over-reports badly, because the
 * driver spills to shared system memory rather than failing. So the GPU budget
 * is ranked by how trustworthy each source is:
 *
 * 1. `maxStorageBufferBindingSize` — the only memory figure WebGPU guarantees.
 *    llama.cpp's WebGPU backend reports exactly this as its free VRAM and stops
 *    offloading layers once it is used up, so for that engine the per-buffer
 *    limit really is the whole budget. Engines that spread weights over many
 *    buffers (MLC, ONNX Runtime) are not bounded this way, so for them it caps
 *    one tensor rather than the model and must not be read as a total.
 * 2. A lookup of the GPU name against a hand-kept table, which goes stale the
 *    moment new hardware ships and means nothing for the integrated GPUs that
 *    share system RAM.
 * 3. A guess from the device class.
 */
export function getModelMemoryBudget(
	specs: SystemSpecs,
	usesWebGPU: boolean,
	engine: InferenceEngine = "multi-buffer",
): MemoryBudget {
	if (!usesWebGPU) {
		return {
			availableGB: specs.memoryGB * CPU_AI_MEMORY_FRACTION,
			source: "system-ram",
		};
	}

	if (engine === "llama.cpp" && specs.webgpuMaxAllocationBytes) {
		return {
			availableGB: specs.webgpuMaxAllocationBytes / 1024 ** 3,
			source: "gpu-allocation-limit",
		};
	}
	if (specs.gpu?.estimatedVRAM) {
		return { availableGB: specs.gpu.estimatedVRAM, source: "gpu-name-lookup" };
	}
	return {
		availableGB: WEBGPU_MEMORY_BY_CATEGORY[specs.deviceCategory] ?? 4,
		source: "device-class-guess",
	};
}

/**
 * Returns the effective memory budget in GB available for model weights + KV cache.
 * WebGPU models consume VRAM; CPU models use a conservative fraction of system RAM.
 */
export function getAvailableModelMemoryGB(
	specs: SystemSpecs,
	usesWebGPU: boolean,
	engine: InferenceEngine = "multi-buffer",
): number {
	return getModelMemoryBudget(specs, usesWebGPU, engine).availableGB;
}

/**
 * Whether the weights can be cached at all.
 *
 * Independent of memory: a model larger than the origin's storage quota cannot
 * be downloaded no matter how much RAM the machine has, and saying so up front
 * beats failing partway through a multi-gigabyte download.
 */
export function fitsStorageQuota(
	specs: SystemSpecs,
	sizeGB: number,
): { fits: boolean; quotaGB?: number } {
	if (!specs.storageQuotaBytes) return { fits: true };
	const quotaGB = specs.storageQuotaBytes / 1024 ** 3;
	return { fits: sizeGB <= quotaGB, quotaGB };
}

/**
 * Estimates total runtime memory for a model at a given total context length.
 */
export function estimateModelMemory(
	sizeGB: number,
	kvBytesPerToken: number,
	contextTokens: number,
	availableGB: number,
): ModelMemoryEstimate {
	const kvCacheGB = (kvBytesPerToken * contextTokens) / 1024 ** 3;
	const bufferGB = (sizeGB + kvCacheGB) * (RUNTIME_BUFFER_MULTIPLIER - 1);
	const totalGB = sizeGB + kvCacheGB + bufferGB;

	let feasibleContext = contextTokens;
	if (totalGB > availableGB) {
		const availableForKV = availableGB / RUNTIME_BUFFER_MULTIPLIER - sizeGB;
		if (availableForKV > 0) {
			const maxTokens = Math.floor(
				(availableForKV * 1024 ** 3) / kvBytesPerToken,
			);
			feasibleContext = Math.max(
				0,
				Math.floor(maxTokens / CONTEXT_GRANULARITY) * CONTEXT_GRANULARITY,
			);
		} else {
			feasibleContext = 0;
		}
	}

	const ratio =
		availableGB > 0 ? totalGB / availableGB : Number.POSITIVE_INFINITY;
	const fit =
		ratio <= 0.75 ? "comfortable" : ratio <= 0.95 ? "tight" : "overflow";

	return {
		weightsGB: sizeGB,
		kvCacheGB,
		bufferGB,
		totalGB,
		feasibleContext,
		fit,
	};
}

/**
 * Estimates a safe token budget after accounting for model context and device memory.
 * Context is rounded down to 1K-token steps to stay conservative.
 */
/**
 * Estimates a model at the context it can actually reach on this device.
 *
 * Estimating at the advertised `contextLength` marks a model "overflow" even
 * when it runs perfectly well at a shorter context — a 128K model that reaches
 * 87K here is a good recommendation, not a red warning.
 *
 * Two things differ from `estimateModelMemory`:
 *
 * 1. The footprint is reported at `min(contextTokens, feasibleContext)`, i.e.
 *    the configuration the user will actually get.
 * 2. `fit` is classified on the **weights**, not the total. Weights are the
 *    fixed cost — you either have room for them or you cannot load the model.
 *    KV cache is the adjustable dial, and `feasibleContext` by construction
 *    consumes whatever memory is left, so classifying the total would report
 *    every context-limited model as overflowing at exactly the point it was
 *    tuned to fit.
 */
export function estimateModelMemoryAtUsableContext(
	sizeGB: number,
	kvBytesPerToken: number,
	contextTokens: number,
	availableGB: number,
): ModelMemoryEstimate {
	const atFullContext = estimateModelMemory(
		sizeGB,
		kvBytesPerToken,
		contextTokens,
		availableGB,
	);

	if (atFullContext.feasibleContext >= contextTokens) {
		return atFullContext;
	}

	const atUsableContext = estimateModelMemory(
		sizeGB,
		kvBytesPerToken,
		atFullContext.feasibleContext,
		availableGB,
	);

	const weightsRatio =
		availableGB > 0
			? (sizeGB * RUNTIME_BUFFER_MULTIPLIER) / availableGB
			: Number.POSITIVE_INFINITY;
	const fit =
		weightsRatio <= 0.75
			? "comfortable"
			: weightsRatio <= 0.95
				? "tight"
				: "overflow";

	return {
		...atUsableContext,
		feasibleContext: atFullContext.feasibleContext,
		fit,
	};
}

export function estimateSafeTokenBudget({
	promptTokens,
	sizeGB,
	kvBytesPerToken,
	availableGB,
	maxContextTokens,
}: {
	promptTokens: number;
	sizeGB: number;
	kvBytesPerToken: number;
	availableGB: number;
	maxContextTokens?: number;
}): TokenBudgetEstimate {
	const memoryEstimate = estimateModelMemory(
		sizeGB,
		kvBytesPerToken,
		typeof maxContextTokens === "number" ? maxContextTokens : promptTokens,
		availableGB,
	);

	const memoryContextTokens =
		typeof maxContextTokens === "number" &&
		memoryEstimate.feasibleContext > maxContextTokens
			? maxContextTokens
			: memoryEstimate.feasibleContext;

	const contextCandidates = [maxContextTokens, memoryContextTokens].filter(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value) && value >= 0,
	);

	const maxTotalContextTokens =
		contextCandidates.length > 0 ? Math.min(...contextCandidates) : undefined;
	const maxNewTokensByContext =
		typeof maxContextTokens === "number"
			? Math.max(0, maxContextTokens - promptTokens)
			: undefined;
	const maxNewTokensByMemory = Math.max(0, memoryContextTokens - promptTokens);
	const maxNewTokens =
		typeof maxTotalContextTokens === "number"
			? Math.max(0, maxTotalContextTokens - promptTokens)
			: undefined;

	return {
		maxTotalContextTokens,
		maxNewTokens,
		maxNewTokensByMemory,
		maxNewTokensByContext,
	};
}
