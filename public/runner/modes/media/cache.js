// Cache Storage inspection for media models.
//
// transformers.js stores every fetched model file in the `transformers-cache`
// cache keyed by its Hub URL (`https://huggingface.co/<repo>/resolve/<rev>/…`).
// Matching on `/<repo>/resolve/` (rather than a bare substring like the chat
// runner does) keeps `org/model` from matching `org/model-large`.

export const TRANSFORMERS_CACHE_NAME = "transformers-cache";

function normalizeUrl(url) {
	const raw = String(url ?? "");
	try {
		return decodeURIComponent(raw).toLowerCase();
	} catch {
		return raw.toLowerCase();
	}
}

export function cacheUrlMatchesRepo(url, repoId) {
	if (!repoId) return false;
	return normalizeUrl(url).includes(
		`/${String(repoId).toLowerCase()}/resolve/`,
	);
}

function cacheStorage() {
	return typeof globalThis.caches !== "undefined" ? globalThis.caches : null;
}

async function transformersCacheUrls() {
	const storage = cacheStorage();
	if (!storage) return [];
	try {
		if (typeof storage.has === "function") {
			if (!(await storage.has(TRANSFORMERS_CACHE_NAME))) return [];
		}
		const cache = await storage.open(TRANSFORMERS_CACHE_NAME);
		const requests = await cache.keys();
		return requests.map((request) => request.url);
	} catch (error) {
		console.warn("[media-runner] cannot read the transformers cache", error);
		return [];
	}
}

/**
 * @param {string[]} repoIds
 * @returns {Promise<Set<string>>} The subset of `repoIds` with cached files.
 */
export async function findCachedRepoIds(repoIds) {
	const urls = await transformersCacheUrls();
	const cached = new Set();
	if (urls.length === 0) return cached;
	for (const repoId of repoIds) {
		if (urls.some((url) => cacheUrlMatchesRepo(url, repoId))) {
			cached.add(repoId);
		}
	}
	return cached;
}

/** @returns {Promise<number>} Entries removed. */
export async function deleteCachedRepo(repoId) {
	const storage = cacheStorage();
	if (!storage || !repoId) return 0;
	const cache = await storage.open(TRANSFORMERS_CACHE_NAME);
	const requests = await cache.keys();
	let removed = 0;
	for (const request of requests) {
		if (cacheUrlMatchesRepo(request.url, repoId)) {
			if (await cache.delete(request)) removed += 1;
		}
	}
	return removed;
}

/**
 * Fetches a small auxiliary file (voice embedding) through the transformers
 * cache, so it works offline once the model has been used and is removed with
 * the model on delete.
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchCachedArrayBuffer(url) {
	const storage = cacheStorage();
	let cache = null;
	try {
		cache = storage ? await storage.open(TRANSFORMERS_CACHE_NAME) : null;
		const hit = await cache?.match(url);
		if (hit) return await hit.arrayBuffer();
	} catch {}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
	}
	try {
		await cache?.put(url, response.clone());
	} catch {}
	return response.arrayBuffer();
}
