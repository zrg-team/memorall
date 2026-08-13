import { getKnownTransformerModelIds } from "./catalog.js";

function normalizeCacheUrl(value) {
	const raw = String(value || "");
	try {
		return decodeURIComponent(raw).toLowerCase();
	} catch {
		return raw.toLowerCase();
	}
}

export function cacheUrlMatchesModelId(url, modelId) {
	const normalizedUrl = normalizeCacheUrl(url);
	const normalizedModelId = modelId.toLowerCase();
	const hfCacheModelId = `models--${normalizedModelId.replace(/\//g, "--")}`;
	const extensionCachePath = `/${normalizedModelId}/resolve/`;

	return (
		normalizedUrl.includes(normalizedModelId) ||
		normalizedUrl.includes(encodeURIComponent(modelId).toLowerCase()) ||
		normalizedUrl.includes(hfCacheModelId) ||
		normalizedUrl.includes(extensionCachePath)
	);
}

export async function getTransformerCacheRequests() {
	const cacheNames = await window.caches.keys();
	const candidateNames = cacheNames.filter((cacheName) => {
		const normalized = cacheName.toLowerCase();
		return (
			normalized.includes("transform") ||
			normalized.includes("huggingface") ||
			normalized.includes("hf")
		);
	});
	const namesToScan =
		candidateNames.length > 0 ? candidateNames : ["transformers-cache"];
	const requests = [];

	for (const cacheName of namesToScan) {
		try {
			const cache = await window.caches.open(cacheName);
			requests.push(...(await cache.keys()));
		} catch (error) {
			console.warn(
				`[transformer-runner] failed to inspect cache ${cacheName}:`,
				error,
			);
		}
	}

	return requests;
}

export async function getCachedTransformerModelIds() {
	const keys = await getTransformerCacheRequests();
	const modelIds = new Set();
	keys.forEach((request) => {
		for (const modelId of getKnownTransformerModelIds()) {
			if (cacheUrlMatchesModelId(request.url, modelId)) {
				modelIds.add(modelId);
			}
		}
	});
	return modelIds;
}
