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

const caches = new WeakMap<object, Map<string, Promise<number[]>>>();

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
	const cache = caches.get(embedding) ?? new Map<string, Promise<number[]>>();
	caches.set(embedding, cache);

	const hit = cache.get(input);
	if (hit) {
		// Re-insert so eviction stays least-recently-used.
		cache.delete(input);
		cache.set(input, hit);
		return hit;
	}

	const pending = computeEmbedding(embedding, input).catch((error) => {
		// A failed inference must not be remembered as the answer.
		cache.delete(input);
		throw error;
	});

	cache.set(input, pending);
	if (cache.size > MAX_CACHED_QUERIES) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	return pending;
};

/** Test seam. */
export const clearEmbeddingCache = (embedding: FlowEmbeddingLike): void => {
	caches.delete(embedding);
};
