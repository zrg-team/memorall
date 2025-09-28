import type { BaseEmbedding } from "@/services/embedding/interfaces/base-embedding";
import type { DatabaseService } from "@/services/database/database-service";
import type { Node, Edge } from "@/services/database/db";

export interface VectorSearchResult<T> {
	item: T;
	similarity: number;
}

export interface SearchWeights {
	sqlPercentage: number;
	vectorPercentage: number;
}

export interface EntitySearchParams {
	names: string[];
	limit: number;
	weights: SearchWeights;
}

export interface FactSearchParams {
	entityNames: string[];
	resolvedEntityIds: string[];
	limit: number;
	weights: SearchWeights;
}

/**
 * Performs vector similarity search for nodes using embeddings
 */
export async function vectorSearchNodes(
	databaseService: DatabaseService,
	embeddingService: BaseEmbedding,
	searchTerms: string[],
	limit: number,
	graphFilter?: string,
): Promise<VectorSearchResult<Node>[]> {
	if (searchTerms.length === 0) return [];

	try {
		// Create combined search text
		const searchText = searchTerms.join(" ");
		const searchEmbedding = await embeddingService.textToVector(searchText);

		const results = await databaseService.use(async ({ db, raw }) => {
			// Use cosine similarity for vector search
			let query = `
				SELECT *,
					1 - (name_embedding <=> $1::vector) as similarity
				FROM nodes
				WHERE name_embedding IS NOT NULL`;

			const params: (string | number)[] = [JSON.stringify(searchEmbedding)];

			if (graphFilter) {
				query += ` AND graph = $${params.length + 1}`;
				params.push(graphFilter);
			}

			query += `
				ORDER BY similarity DESC
				LIMIT $${params.length + 1}`;
			params.push(limit);

			const queryResult = await raw(query, params);
			// PGlite returns { rows: [...] } structure
			const rows = (queryResult as { rows: [] })?.rows || [];
			return rows as Array<Node & { similarity: number }>;
		});

		return (
			results?.map((row) => ({
				item: {
					id: row.id,
					nodeType: row.nodeType,
					name: row.name,
					summary: row.summary,
					attributes: row.attributes,
					groupId: row.groupId,
					nameEmbedding: row.nameEmbedding,
					graph: row.graph,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				},
				similarity: row.similarity,
			})) || []
		);
	} catch (error) {
		console.warn("Vector search failed, falling back to empty results:", error);
		return [];
	}
}

/**
 * Performs vector similarity search for edges using embeddings
 */
export async function vectorSearchEdges(
	databaseService: DatabaseService,
	embeddingService: BaseEmbedding,
	searchTerms: string[],
	limit: number,
	graphFilter?: string,
): Promise<VectorSearchResult<Edge>[]> {
	if (searchTerms.length === 0) return [];

	try {
		// Create combined search text
		const searchText = searchTerms.join(" ");
		const searchEmbedding = await embeddingService.textToVector(searchText);

		const results = await databaseService.use(async ({ db, raw }) => {
			// Use cosine similarity for vector search on both fact and type embeddings
			let query = `
				SELECT *,
					GREATEST(
						1 - (fact_embedding <=> $1::vector),
						1 - (type_embedding <=> $1::vector)
					) as similarity
				FROM edges
				WHERE fact_embedding IS NOT NULL OR type_embedding IS NOT NULL`;

			const params: (string | number)[] = [JSON.stringify(searchEmbedding)];

			if (graphFilter) {
				query += ` AND graph = $${params.length + 1}`;
				params.push(graphFilter);
			}

			query += `
				ORDER BY similarity DESC
				LIMIT $${params.length + 1}`;
			params.push(limit);

			const queryResult = await raw(query, params);
			// PGlite returns { rows: [...] } structure
			const rows = (queryResult as { rows: [] })?.rows || [];
			return rows as Array<Edge & { similarity: number }>;
		});

		return (
			results?.map((row) => ({
				item: {
					id: row.id,
					sourceId: row.sourceId,
					destinationId: row.destinationId,
					edgeType: row.edgeType,
					factText: row.factText,
					validAt: row.validAt,
					invalidAt: row.invalidAt,
					recordedAt: row.recordedAt,
					attributes: row.attributes,
					groupId: row.groupId,
					isCurrent: row.isCurrent,
					provenanceWeightCache: row.provenanceWeightCache,
					provenanceCountCache: row.provenanceCountCache,
					factEmbedding: row.factEmbedding,
					typeEmbedding: row.typeEmbedding,
					graph: row.graph,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				},
				similarity: row.similarity,
			})) || []
		);
	} catch (error) {
		console.warn(
			"Vector search for edges failed, falling back to empty results:",
			error,
		);
		return [];
	}
}

/**
 * Combines and weights SQL and vector search results
 */
export function combineSearchResults<T>(
	sqlResults: T[],
	vectorResults: VectorSearchResult<T>[],
	weights: SearchWeights,
	totalLimit: number,
	getKey: (item: T) => string,
): T[] {
	// Calculate actual limits based on weights and fallback logic
	let sqlLimit = Math.floor((totalLimit * weights.sqlPercentage) / 100);
	let vectorLimit = Math.floor((totalLimit * weights.vectorPercentage) / 100);

	// Adjust if one method has no results (fallback logic)
	if (sqlResults.length === 0 && vectorResults.length > 0) {
		vectorLimit = totalLimit;
		sqlLimit = 0;
	} else if (vectorResults.length === 0 && sqlResults.length > 0) {
		sqlLimit = totalLimit;
		vectorLimit = 0;
	}

	// Take weighted portions
	const selectedSqlResults = sqlResults.slice(0, sqlLimit);
	const selectedVectorResults = vectorResults
		.slice(0, vectorLimit)
		.map((r) => r.item);

	// Combine and deduplicate based on key function
	const combined = new Map<string, T>();

	// Add SQL results first (they have priority in deduplication)
	for (const result of selectedSqlResults) {
		combined.set(getKey(result), result);
	}

	// Add vector results if not already present
	for (const result of selectedVectorResults) {
		const key = getKey(result);
		if (!combined.has(key)) {
			combined.set(key, result);
		}
	}

	return Array.from(combined.values()).slice(0, totalLimit);
}
