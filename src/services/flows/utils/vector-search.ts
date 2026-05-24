import type { IFlowDatabase } from "../interfaces/database";
import type { IFlowEmbeddingService } from "../interfaces/embedding";
import type { Edge, Node } from "../interfaces/knowledge";
import type { IFlowLogger } from "../interfaces/logger";
import { consoleFlowLogger } from "../interfaces/logger";
import { getCurrentEmbeddingColumns } from "./embedding-size-config";

export type FlowEmbeddingLike = Pick<
	IFlowEmbeddingService,
	"embeddings" | "textToVector" | "textsToVectors" | "isReady" | "dimensions"
>;

export interface VectorSearchResult<T> {
	item: T;
	similarity: number;
}

export interface SearchWeights {
	sqlPercentage: number;
	vectorPercentage: number;
}

export type VectorSearchNode = Node;
export type VectorSearchEdge = Edge;

const valueToString = (value: unknown, fallback = ""): string =>
	typeof value === "string" ? value : fallback;

const valueToRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;

const valueToOptionalDate = (value: unknown): Date | undefined =>
	typeof value === "string" || value instanceof Date
		? new Date(value)
		: undefined;

const createEmbedding = async (
	embedding: FlowEmbeddingLike,
	input: string,
): Promise<number[]> => {
	if (!embedding.embeddings) {
		return embedding.textToVector(input);
	}
	const response = await embedding.embeddings.create({ input });
	return response.data[0]?.embedding ?? [];
};

const getRows = <T>(value: unknown): T[] => {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === "object" && "rows" in value) {
		const rows = (value as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as T[]) : [];
	}
	return [];
};

export async function vectorSearchNodes(
	db: IFlowDatabase,
	emb: FlowEmbeddingLike,
	loggerOrTerms: IFlowLogger | string[],
	termsOrLimit: string[] | number,
	limitOrGraphId?: number | string,
	graphId?: string,
): Promise<VectorSearchResult<Node>[]> {
	const logger = Array.isArray(loggerOrTerms)
		? consoleFlowLogger
		: loggerOrTerms;
	const terms = Array.isArray(loggerOrTerms)
		? loggerOrTerms
		: (termsOrLimit as string[]);
	const limit = Array.isArray(loggerOrTerms)
		? (termsOrLimit as number)
		: (limitOrGraphId as number);
	const graphFilter = Array.isArray(loggerOrTerms)
		? (limitOrGraphId as string | undefined)
		: graphId;

	if (terms.length === 0) return [];

	try {
		const searchEmbedding = await createEmbedding(emb, terms.join(" "));
		const columns = await getCurrentEmbeddingColumns();
		const params: unknown[] = [JSON.stringify(searchEmbedding)];
		let query = `
			SELECT id, name, summary, attributes, graph, created_at, updated_at,
				1 - (${columns.nameEmbedding} <=> $1::vector) as similarity
			FROM nodes
			WHERE ${columns.nameEmbedding} IS NOT NULL`;

		if (graphFilter) {
			params.push(graphFilter);
			query += ` AND graph = $${params.length}`;
		} else {
			query += " AND (graph = '' OR graph IS NULL)";
		}

		params.push(limit);
		query += ` ORDER BY similarity DESC LIMIT $${params.length}`;
		const rows = getRows<Record<string, unknown>>(
			db.raw ? await db.raw(query, params) : [],
		);

		return rows.map((row) => ({
			item: {
				id: valueToString(row.id),
				nodeType: valueToString(row.node_type, "entity"),
				name: valueToString(row.name),
				summary: typeof row.summary === "string" ? row.summary : null,
				attributes: valueToRecord(row.attributes),
				graph: typeof row.graph === "string" ? row.graph : null,
				createdAt: valueToOptionalDate(row.created_at),
				updatedAt: valueToOptionalDate(row.updated_at),
			},
			similarity: Number(row.similarity ?? 0),
		}));
	} catch (error) {
		logger.warn("Vector search failed, falling back to empty results:", error);
		return [];
	}
}

export async function vectorSearchEdges(
	db: IFlowDatabase,
	emb: FlowEmbeddingLike,
	loggerOrTerms: IFlowLogger | string[],
	termsOrLimit: string[] | number,
	limitOrGraphId?: number | string,
	graphId?: string,
): Promise<VectorSearchResult<Edge>[]> {
	const logger = Array.isArray(loggerOrTerms)
		? consoleFlowLogger
		: loggerOrTerms;
	const terms = Array.isArray(loggerOrTerms)
		? loggerOrTerms
		: (termsOrLimit as string[]);
	const limit = Array.isArray(loggerOrTerms)
		? (termsOrLimit as number)
		: (limitOrGraphId as number);
	const graphFilter = Array.isArray(loggerOrTerms)
		? (limitOrGraphId as string | undefined)
		: graphId;

	if (terms.length === 0) return [];

	try {
		const searchEmbedding = await createEmbedding(emb, terms.join(" "));
		const columns = await getCurrentEmbeddingColumns();
		const params: unknown[] = [JSON.stringify(searchEmbedding)];
		let query = `
			SELECT id, source_id, destination_id, edge_type, fact_text, valid_at,
				invalid_at, attributes, graph, created_at, updated_at,
				GREATEST(
					1 - (${columns.factEmbedding} <=> $1::vector),
					1 - (${columns.typeEmbedding} <=> $1::vector)
				) as similarity
			FROM edges
			WHERE (${columns.factEmbedding} IS NOT NULL OR ${columns.typeEmbedding} IS NOT NULL)`;

		if (graphFilter) {
			params.push(graphFilter);
			query += ` AND graph = $${params.length}`;
		} else {
			query += " AND (graph = '' OR graph IS NULL)";
		}

		params.push(limit);
		query += ` ORDER BY similarity DESC LIMIT $${params.length}`;
		const rows = getRows<Record<string, unknown>>(
			db.raw ? await db.raw(query, params) : [],
		);

		return rows.map((row) => ({
			item: {
				id: valueToString(row.id),
				sourceId: valueToString(row.source_id),
				destinationId: valueToString(row.destination_id),
				edgeType: valueToString(row.edge_type),
				factText: typeof row.fact_text === "string" ? row.fact_text : null,
				validAt: valueToOptionalDate(row.valid_at),
				invalidAt: valueToOptionalDate(row.invalid_at),
				attributes: valueToRecord(row.attributes),
				graph: typeof row.graph === "string" ? row.graph : null,
				createdAt: valueToOptionalDate(row.created_at),
				updatedAt: valueToOptionalDate(row.updated_at),
			},
			similarity: Number(row.similarity ?? 0),
		}));
	} catch (error) {
		logger.warn(
			"Vector search for edges failed, falling back to empty results:",
			error,
		);
		return [];
	}
}

export function combineSearchResults<T>(
	sqlResults: T[],
	vectorResults: VectorSearchResult<T>[],
	weights: SearchWeights,
	totalLimit: number,
	getKey: (item: T) => string,
): T[] {
	let sqlLimit = Math.floor((totalLimit * weights.sqlPercentage) / 100);
	let vectorLimit = Math.floor((totalLimit * weights.vectorPercentage) / 100);

	if (sqlResults.length === 0 && vectorResults.length > 0) {
		vectorLimit = totalLimit;
		sqlLimit = 0;
	} else if (vectorResults.length === 0 && sqlResults.length > 0) {
		sqlLimit = totalLimit;
		vectorLimit = 0;
	}

	const combined = new Map<string, T>();
	for (const result of sqlResults.slice(0, sqlLimit)) {
		combined.set(getKey(result), result);
	}
	for (const result of vectorResults.slice(0, vectorLimit).map((r) => r.item)) {
		const key = getKey(result);
		if (!combined.has(key)) combined.set(key, result);
	}

	return Array.from(combined.values()).slice(0, totalLimit);
}
