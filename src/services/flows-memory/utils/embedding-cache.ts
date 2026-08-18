import type { FlowEmbeddingLike } from "./vector-search";

/**
 * Query embeddings, computed once per text.
 *
 * One `smart-retrieve` pass embeds the same query repeatedly: once directly, then
 * again inside each node search and each edge search, because those take text and
 * embed it themselves. On the base path that is three inferences of identical
 * input, serially, before the model is called — and with a remote embedding
 * provider, three network round trips.
 *
 * Caching is safe here because embedding is deterministic: the same model given
 * the same text returns the same vector. The risk worth guarding is the model
 * changing underneath a cached vector, and the key handles that by construction.
 * `EmbeddingService.get(name)` hands back a stable instance and swaps in a new
 * object when the model changes, so a WeakMap keyed on that instance is hot while
 * the model is unchanged, cold the moment it is not, and collectable with it.
 *
 * The promise is cached rather than the vector, so two callers asking for the
 * same text concurrently share one inference instead of racing into two.
 */

/** Distinct query texts held per embedding instance. */
const MAX_CACHED_QUERIES = 64;

/**
 * How long a cached vector is kept.
 *
 * This is memory hygiene, not correctness: a vector never goes stale for the
 * model that produced it, and a model change is already handled by the key. What
 * it bounds is age, so a long-lived embedding service cannot sit on vectors for
 * queries nobody will ask again. Ten minutes comfortably covers a retrieval pass
 * and the follow-up questions around it, which is where the repeats actually are.
 *
 * Expiry is lazy — checked on access and swept on insert — so there are no timers
 * and no work happens for a cache nobody is touching.
 */
const CACHE_TTL_MS = 10 * 60_000;

interface CacheEntry {
	vector: Promise<number[]>;
	expiresAt: number;
}

const caches = new WeakMap<object, Map<string, CacheEntry>>();

const computeEmbedding = async (
	embedding: FlowEmbeddingLike,
	input: string,
): Promise<number[]> => {
	if (!embedding.embeddings) {
		return embedding.textToVector(input);
	}
	const response = await embedding.embeddings.create({ input });
	return response.data[0]?.embedding ?? [];
};

export const embedQuery = (
	embedding: FlowEmbeddingLike,
	input: string,
): Promise<number[]> => {
	const cache = caches.get(embedding) ?? new Map<string, CacheEntry>();
	caches.set(embedding, cache);

	const now = Date.now();
	const hit = cache.get(input);
	if (hit) {
		if (hit.expiresAt > now) {
			// Re-insert so eviction stays least-recently-used. The deadline is not
			// extended: an entry lives at most CACHE_TTL_MS from when it was computed,
			// so a query asked forever cannot pin a vector forever.
			cache.delete(input);
			cache.set(input, hit);
			return hit.vector;
		}
		cache.delete(input);
	}

	const vector = computeEmbedding(embedding, input).catch((error) => {
		// A failed inference must not be remembered as the answer.
		cache.delete(input);
		throw error;
	});

	cache.set(input, { vector, expiresAt: now + CACHE_TTL_MS });

	// Drop anything that has aged out, then fall back to least-recently-used if
	// the cache is still over its bound.
	for (const [key, entry] of cache) {
		if (entry.expiresAt <= now) cache.delete(key);
	}
	while (cache.size > MAX_CACHED_QUERIES) {
		const oldest = cache.keys().next();
		if (oldest.done) break;
		cache.delete(oldest.value);
	}
	return vector;
};

/** Test seam. */
export const clearEmbeddingCache = (embedding: FlowEmbeddingLike): void => {
	caches.delete(embedding);
};
