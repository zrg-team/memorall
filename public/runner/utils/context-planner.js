// Decide how large a context window a model can actually be given on this
// device, and say what limited it.
//
// wllama v3 removed `n_ctx_auto`, so nothing sizes the window for us: ask for
// more than the device can hold and the load fails outright. The three local
// runners each carried their own copy of the same arithmetic, which meant three
// places to fix and three chances to drift.
//
// The cost model is the standard one. Weights are fixed; KV cache is the dial:
//
//   total ≈ weights + n_ctx × kvBytesPerToken, times a runtime overhead factor
//
// so the reachable window is (budget / overhead − weights) / kvBytesPerToken.
// What the old code lacked was not the formula but the ceilings around it.

const BYTES_PER_GB = 1024 ** 3;

/** Compute buffers, allocator slack and fragmentation on top of weights + KV. */
export const RUNTIME_OVERHEAD = 1.2;

/** Windows are quoted in whole 1K steps; a sub-1K window is not worth loading. */
export const CONTEXT_GRANULARITY = 1024;

/**
 * A wasm32 heap cannot exceed 4 GiB — weights, KV and compute buffers all live
 * in it. Browsers without MEMORY64 (Safari, and anything in wllama's compat
 * mode) hit this wall no matter how much RAM the machine has.
 */
export const WASM32_ADDRESS_SPACE_BYTES = 4 * 1024 ** 3;

export const LIMITED_BY = {
	CEILING: "ceiling",
	TRAINED: "trained-context",
	MEMORY: "memory",
	ADDRESS_SPACE: "address-space",
	ALLOCATION: "allocation",
	DOES_NOT_FIT: "does-not-fit",
	UNKNOWN: "unknown",
};

function isPositive(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundDownToGranularity(tokens) {
	return Math.max(
		0,
		Math.floor(tokens / CONTEXT_GRANULARITY) * CONTEXT_GRANULARITY,
	);
}

/**
 * @typedef {object} ContextPlan
 * @property {number} contextTokens Window to request, 0 when the model cannot fit.
 * @property {string} limitedBy Which ceiling bound the result.
 * @property {boolean} fits
 */

/**
 * @param {object} [input]
 * @param {number} [input.weightsBytes] Model weights on this backend.
 * @param {number} [input.kvBytesPerToken] KV cost of one token.
 * @param {number} [input.budgetBytes] Memory this backend may use (VRAM or RAM share).
 * @param {number} [input.trainedContext] The model's own n_ctx_train.
 * @param {number} [input.ceiling] Product cap on the window.
 * @param {number} [input.maxAllocationBytes] WebGPU maxBufferSize, per allocation.
 * @param {number} [input.layerCount] Layers, so the per-allocation cap can be applied per layer.
 * @param {number} [input.addressSpaceBytes] Hard heap ceiling (wasm32).
 * @returns {ContextPlan}
 */
export function planContextWindow(input) {
	const {
		weightsBytes,
		kvBytesPerToken,
		budgetBytes,
		trainedContext,
		ceiling,
		maxAllocationBytes,
		layerCount,
		addressSpaceBytes,
	} = input ?? {};

	if (!isPositive(kvBytesPerToken) || !isPositive(budgetBytes)) {
		return {
			contextTokens: isPositive(ceiling) ? ceiling : 0,
			limitedBy: LIMITED_BY.UNKNOWN,
			fits: true,
		};
	}

	const weights = isPositive(weightsBytes) ? weightsBytes : 0;

	// A hard heap ceiling caps the budget before anything else is considered.
	let effectiveBudget = budgetBytes;
	let budgetLimitedBy = LIMITED_BY.MEMORY;
	if (isPositive(addressSpaceBytes) && addressSpaceBytes < effectiveBudget) {
		effectiveBudget = addressSpaceBytes;
		budgetLimitedBy = LIMITED_BY.ADDRESS_SPACE;
	}

	const budgetForKV = effectiveBudget / RUNTIME_OVERHEAD - weights;
	if (budgetForKV <= 0) {
		return {
			contextTokens: 0,
			limitedBy:
				budgetLimitedBy === LIMITED_BY.ADDRESS_SPACE
					? LIMITED_BY.ADDRESS_SPACE
					: LIMITED_BY.DOES_NOT_FIT,
			fits: false,
		};
	}

	let tokens = roundDownToGranularity(budgetForKV / kvBytesPerToken);
	let limitedBy = budgetLimitedBy;

	// WebGPU never reports VRAM; maxBufferSize is the only real number it gives,
	// and it caps a single allocation. The KV cache is allocated per layer, so
	// that is the granularity the cap applies at.
	if (isPositive(maxAllocationBytes) && isPositive(layerCount)) {
		const kvPerTokenPerLayer = kvBytesPerToken / layerCount;
		if (isPositive(kvPerTokenPerLayer)) {
			const allocationTokens = roundDownToGranularity(
				maxAllocationBytes / kvPerTokenPerLayer,
			);
			if (allocationTokens < tokens) {
				tokens = allocationTokens;
				limitedBy = LIMITED_BY.ALLOCATION;
			}
		}
	}

	if (isPositive(trainedContext) && trainedContext < tokens) {
		tokens = trainedContext;
		limitedBy = LIMITED_BY.TRAINED;
	}

	if (isPositive(ceiling) && ceiling < tokens) {
		tokens = ceiling;
		limitedBy = LIMITED_BY.CEILING;
	}

	return {
		contextTokens: tokens,
		limitedBy: tokens === 0 ? LIMITED_BY.DOES_NOT_FIT : limitedBy,
		fits: tokens > 0,
	};
}

/**
 * Plan from the memory hint the app sends into a runner.
 *
 * Keeps the hint's GB-based vocabulary at the edge and converts once, so the
 * planner itself only ever deals in bytes.
 *
 * @param {object} [memoryHint]
 * @param {object} [options]
 * @param {number} [options.budgetGB] Override for the backend actually in use.
 * @param {number} [options.ceiling]
 * @param {number} [options.maxAllocationBytes]
 * @param {number} [options.layerCount]
 * @param {number} [options.addressSpaceBytes]
 * @param {number} [options.kvBytesPerToken] Measured value, beating the hint's.
 * @param {number} [options.trainedContext] Measured value, beating the hint's.
 * @param {number} [options.weightsBytes] Measured value, beating the hint's sizeGB.
 * @returns {ContextPlan | undefined} undefined when the hint says nothing usable.
 */
export function planContextFromMemoryHint(memoryHint, options = {}) {
	const hint = memoryHint && typeof memoryHint === "object" ? memoryHint : {};
	const budgetGB =
		typeof options.budgetGB === "number" ? options.budgetGB : hint.availableGB;

	// A measured value always beats a catalogued one, and is the only source at
	// all for a model no catalogue entry covers.
	const kvBytesPerToken = options.kvBytesPerToken ?? hint.kvBytesPerToken;
	const trainedContext = options.trainedContext ?? hint.contextLength;
	const weightsBytes = isPositive(options.weightsBytes)
		? options.weightsBytes
		: isPositive(hint.sizeGB)
			? hint.sizeGB * BYTES_PER_GB
			: 0;

	if (!isPositive(budgetGB) || !isPositive(kvBytesPerToken)) {
		return undefined;
	}

	return planContextWindow({
		weightsBytes,
		kvBytesPerToken,
		budgetBytes: budgetGB * BYTES_PER_GB,
		trainedContext,
		ceiling: options.ceiling,
		maxAllocationBytes: options.maxAllocationBytes,
		layerCount: options.layerCount,
		addressSpaceBytes: options.addressSpaceBytes,
	});
}

/**
 * Device ceilings that no memory estimate can talk its way past.
 * @returns {Promise<{ maxAllocationBytes?: number, addressSpaceBytes?: number, storageQuotaBytes?: number }>}
 */
export async function detectDeviceCeilings() {
	const ceilings = {};

	try {
		if (typeof navigator !== "undefined" && navigator.gpu) {
			const adapter = await navigator.gpu.requestAdapter();
			const limit = adapter?.limits?.maxStorageBufferBindingSize;
			if (limit) ceilings.maxAllocationBytes = Number(limit);
		}
	} catch {}

	try {
		new WebAssembly.Memory({ address: "i64", initial: 1n });
	} catch {
		// No MEMORY64: the whole wasm heap is confined to 4 GiB.
		ceilings.addressSpaceBytes = WASM32_ADDRESS_SPACE_BYTES;
	}

	try {
		const estimate = await navigator?.storage?.estimate?.();
		if (estimate?.quota) ceilings.storageQuotaBytes = estimate.quota;
	} catch {}

	return ceilings;
}
