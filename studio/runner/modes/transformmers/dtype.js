import { getTransformersContext, getWebgpuCapabilities } from "./context.js";

const dtypeAvailabilityCache = new Map();
const resolvedDtypeCache = new Map();
const DTYPE_STORAGE_PREFIX = "transformer:available-dtypes:";

export function isDtypeAuto(dtype) {
	return !dtype || dtype === "auto";
}

export function dtypeSpecLabel(dtypeSpec) {
	if (!dtypeSpec || typeof dtypeSpec === "string") {
		return dtypeSpec || "auto";
	}

	return Object.entries(dtypeSpec)
		.map(([moduleName, dtype]) => `${moduleName}:${dtype}`)
		.join(",");
}

export function dtypeSpecIncludesF16(dtypeSpec) {
	if (typeof dtypeSpec === "string") {
		return dtypeSpec.includes("f16") || dtypeSpec === "fp16";
	}

	if (!dtypeSpec || typeof dtypeSpec !== "object") {
		return false;
	}

	return Object.values(dtypeSpec).some(
		(dtype) =>
			typeof dtype === "string" &&
			(dtype.includes("f16") || dtype === "fp16"),
	);
}

function normalizeAvailableDtypes(value) {
	if (Array.isArray(value)) {
		return new Set(value.filter((dtype) => typeof dtype === "string"));
	}

	if (value instanceof Set) {
		return new Set(
			Array.from(value).filter((dtype) => typeof dtype === "string"),
		);
	}

	if (value && typeof value === "object") {
		return new Set(
			Object.keys(value).filter((dtype) => typeof dtype === "string"),
		);
	}

	return new Set(["fp32"]);
}

function readAvailableDtypesCache(modelId) {
	if (dtypeAvailabilityCache.has(modelId)) {
		return { hit: true, value: dtypeAvailabilityCache.get(modelId) };
	}

	try {
		const raw = localStorage.getItem(DTYPE_STORAGE_PREFIX + modelId);
		if (raw !== null) {
			const value = normalizeAvailableDtypes(JSON.parse(raw));
			dtypeAvailabilityCache.set(modelId, value);
			return { hit: true, value };
		}
	} catch {}

	return { hit: false, value: undefined };
}

function writeAvailableDtypesCache(modelId, available) {
	dtypeAvailabilityCache.set(modelId, available);
	try {
		localStorage.setItem(
			DTYPE_STORAGE_PREFIX + modelId,
			JSON.stringify(Array.from(available)),
		);
	} catch {}
}

async function getAvailableDtypes(modelId) {
	const cached = readAvailableDtypesCache(modelId);
	if (cached.hit) {
		return cached.value;
	}

	const { ModelRegistry } = getTransformersContext();
	let available = new Set(["fp32"]);
	if (ModelRegistry?.get_available_dtypes) {
		try {
			available = normalizeAvailableDtypes(
				await ModelRegistry.get_available_dtypes(modelId),
			);
			if (available.size === 0) {
				available.add("fp32");
			}
		} catch (error) {
			console.warn(
				`[transformer-runner] failed to query available dtypes for ${modelId}:`,
				error,
			);
		}
	}

	dtypeAvailabilityCache.set(modelId, available);
	return available;
}

export function recordLoadableDtype(modelId, dtypeSpec) {
	if (!modelId || typeof dtypeSpec !== "string") {
		return;
	}

	const available = new Set(dtypeAvailabilityCache.get(modelId) ?? []);
	available.add(dtypeSpec);
	writeAvailableDtypesCache(modelId, available);

	for (const cacheKey of Array.from(resolvedDtypeCache.keys())) {
		if (cacheKey.startsWith(`${modelId}:`)) {
			resolvedDtypeCache.delete(cacheKey);
		}
	}
}

export function clearLoadableDtypeCache(modelId) {
	if (!modelId) {
		return;
	}

	dtypeAvailabilityCache.delete(modelId);
	try {
		localStorage.removeItem(DTYPE_STORAGE_PREFIX + modelId);
	} catch {}

	for (const cacheKey of Array.from(resolvedDtypeCache.keys())) {
		if (cacheKey.startsWith(`${modelId}:`)) {
			resolvedDtypeCache.delete(cacheKey);
		}
	}
}

function getDeviceDtypePreference(device) {
	const webgpuCapabilities = getWebgpuCapabilities();
	if (device === "webgpu") {
		return webgpuCapabilities.supportsF16
			? ["q4f16", "q4", "q8", "fp16", "fp32"]
			: ["q4", "q8", "fp32"];
	}

	return ["q4", "q8", "int8", "uint8", "fp16", "fp32"];
}

export async function resolveDtypeChainForDevice(modelId, device, config) {
	const webgpuCapabilities = getWebgpuCapabilities();
	const cacheKey = `${modelId}:${device}:${config.dtype ?? "auto"}`;
	if (!config.moduleDtype && resolvedDtypeCache.has(cacheKey)) {
		return resolvedDtypeCache.get(cacheKey);
	}

	if (config.moduleDtype && typeof config.moduleDtype === "object") {
		if (device === "webgpu" && dtypeSpecIncludesF16(config.moduleDtype)) {
			return webgpuCapabilities.supportsF16 ? [config.moduleDtype] : [];
		}
		return [config.moduleDtype];
	}

	const available = await getAvailableDtypes(modelId);
	const preference = getDeviceDtypePreference(device);
	const chain = [];

	const explicitDtypeUsable =
		!isDtypeAuto(config.dtype) &&
		!(
			device === "webgpu" &&
			dtypeSpecIncludesF16(config.dtype) &&
			!webgpuCapabilities.supportsF16
		) &&
		!(device !== "webgpu" && config.dtype === "q4f16");
	if (explicitDtypeUsable) {
		chain.push(config.dtype);
	}

	for (const dtype of preference) {
		if (available.has(dtype) && !chain.includes(dtype)) {
			chain.push(dtype);
		}
	}

	if (available.has("fp32") && !chain.includes("fp32")) {
		chain.push("fp32");
	}

	if (chain.length === 0) {
		chain.push("fp32");
	}

	resolvedDtypeCache.set(cacheKey, chain);
	return chain;
}

export function isLoadRetryable(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	const normalized = message.toLowerCase();

	return (
		normalized.includes("aborted") ||
		normalized.includes("abort") ||
		normalized.includes("memory") ||
		normalized.includes("array buffer allocation failed") ||
		normalized.includes("out of memory") ||
		normalized.includes("oom") ||
		normalized.includes("device lost") ||
		normalized.includes("shader-f16") ||
		normalized.includes("fp16") ||
		normalized.includes("dtype") ||
		normalized.includes("not found") ||
		/^\d+$/.test(message)
	);
}
