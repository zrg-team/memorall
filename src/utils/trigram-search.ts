import type { DatabaseService } from "@/services/database/database-service";
import type { Node, Edge } from "@/services/database/db";

export interface TrigramSearchResult<T> {
	item: T;
	score: number;
}

export interface TrigramSearchParams {
	threshold?: number; // Minimum similarity threshold (default: 0.1)
}

/**
 * Prepares search text for trigram similarity
 */
function prepareSearchText(searchTerms: string[]): string {
	return searchTerms.join(" ").toLowerCase().trim();
}

/**
 * Performs trigram similarity search on nodes using database SQL function
 */
export async function trigramSearchNodes(
	databaseService: DatabaseService,
	searchTerms: string[],
	limit: number,
	params: TrigramSearchParams = {},
): Promise<TrigramSearchResult<Node>[]> {
	if (searchTerms.length === 0) return [];

	try {
		const { threshold = 0.1 } = params;
		const searchText = prepareSearchText(searchTerms);

		if (!searchText) return [];

		const results = await databaseService.use(async ({ raw }) => {
			const queryResult = await raw(
				"SELECT * FROM search_nodes_trigram($1, $2, $3)",
				[searchText, threshold, limit],
			);
			const rows = (queryResult as { rows: [] })?.rows || [];
			return rows as Array<Node & { similarity_score: number }>;
		});

		return (
			results?.map((row: any) => ({
				item: {
					id: row.id,
					nodeType: row.node_type,
					name: row.name,
					summary: row.summary,
					attributes: row.attributes,
					nameEmbedding: row.name_embedding,
					graph: row.graph,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				},
				score: row.similarity_score,
			})) || []
		);
	} catch (error) {
		console.warn(
			"Trigram search for nodes failed, falling back to empty results:",
			error,
		);
		return [];
	}
}

/**
 * Performs trigram similarity search on edges using database SQL function
 */
export async function trigramSearchEdges(
	databaseService: DatabaseService,
	searchTerms: string[],
	limit: number,
	params: TrigramSearchParams = {},
): Promise<TrigramSearchResult<Edge>[]> {
	if (searchTerms.length === 0) return [];

	try {
		const { threshold = 0.1 } = params;
		const searchText = prepareSearchText(searchTerms);

		if (!searchText) return [];

		const results = await databaseService.use(async ({ raw }) => {
			const queryResult = await raw(
				"SELECT * FROM search_edges_trigram($1, $2, $3)",
				[searchText, threshold, limit],
			);
			const rows = (queryResult as { rows: [] })?.rows || [];
			return rows as Array<Edge & { similarity_score: number }>;
		});

		return (
			results?.map((row: any) => ({
				item: {
					id: row.id,
					sourceId: row.source_id,
					destinationId: row.destination_id,
					edgeType: row.edge_type,
					factText: row.fact_text,
					validAt: row.valid_at,
					invalidAt: row.invalid_at,
					recordedAt: row.recorded_at,
					attributes: row.attributes,
					isCurrent: row.is_current,
					provenanceWeightCache: row.provenance_weight_cache,
					provenanceCountCache: row.provenance_count_cache,
					factEmbedding: row.fact_embedding,
					typeEmbedding: row.type_embedding,
					graph: row.graph,
					createdAt: row.created_at,
					updatedAt: row.updated_at,
				},
				score: row.similarity_score,
			})) || []
		);
	} catch (error) {
		console.warn(
			"Trigram search for edges failed, falling back to empty results:",
			error,
		);
		return [];
	}
}

/**
 * Combines and weights SQL, vector and trigram search results
 */
export function combineSearchResultsWithTrigram<T>(
	sqlResults: T[],
	vectorResults: Array<{ item: T; similarity: number }>,
	trigramResults: TrigramSearchResult<T>[],
	weights: {
		sqlPercentage: number;
		vectorPercentage: number;
		trigramPercentage: number;
	},
	totalLimit: number,
	getKey: (item: T) => string,
): T[] {
	// Normalize weights to 100%
	const totalWeight =
		weights.sqlPercentage +
		weights.vectorPercentage +
		weights.trigramPercentage;
	const normalizedWeights = {
		sql: weights.sqlPercentage / totalWeight,
		vector: weights.vectorPercentage / totalWeight,
		trigram: weights.trigramPercentage / totalWeight,
	};

	// Calculate limits based on weights
	let sqlLimit = Math.floor(totalLimit * normalizedWeights.sql);
	let vectorLimit = Math.floor(totalLimit * normalizedWeights.vector);
	let trigramLimit = Math.floor(totalLimit * normalizedWeights.trigram);

	// Fallback logic: if one method has no results, redistribute to others
	const hasResults = {
		sql: sqlResults.length > 0,
		vector: vectorResults.length > 0,
		trigram: trigramResults.length > 0,
	};

	const activeResults = Object.values(hasResults).filter(Boolean).length;

	if (activeResults === 0) return [];

	if (activeResults < 3) {
		// Redistribute limits among active methods
		const availableLimit = totalLimit;
		sqlLimit = hasResults.sql ? Math.floor(availableLimit / activeResults) : 0;
		vectorLimit = hasResults.vector
			? Math.floor(availableLimit / activeResults)
			: 0;
		trigramLimit = hasResults.trigram
			? Math.floor(availableLimit / activeResults)
			: 0;

		// Handle remainder
		const remainder = availableLimit - (sqlLimit + vectorLimit + trigramLimit);
		if (remainder > 0 && hasResults.sql) sqlLimit += remainder;
		else if (remainder > 0 && hasResults.vector) vectorLimit += remainder;
		else if (remainder > 0 && hasResults.trigram) trigramLimit += remainder;
	}

	// Take weighted portions
	const selectedSqlResults = sqlResults.slice(0, sqlLimit);
	const selectedVectorResults = vectorResults
		.slice(0, vectorLimit)
		.map((r) => r.item);
	const selectedTrigramResults = trigramResults
		.slice(0, trigramLimit)
		.map((r) => r.item);

	// Combine and deduplicate based on key function
	const combined = new Map<string, T>();

	// Add results in order of priority (SQL first, then vector, then trigram)
	for (const result of selectedSqlResults) {
		combined.set(getKey(result), result);
	}

	for (const result of selectedVectorResults) {
		const key = getKey(result);
		if (!combined.has(key)) {
			combined.set(key, result);
		}
	}

	for (const result of selectedTrigramResults) {
		const key = getKey(result);
		if (!combined.has(key)) {
			combined.set(key, result);
		}
	}

	return Array.from(combined.values()).slice(0, totalLimit);
}
