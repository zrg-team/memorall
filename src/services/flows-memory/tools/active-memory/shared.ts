import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { ToolExecutionContext } from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import type {
	Edge,
	KnowledgeDatabaseSchema,
	NewEdge,
	NewNode,
	Node,
} from "../../interfaces/knowledge";
import type { IEmbeddingService } from "../../interfaces/embedding";
import { getRuntimeGraphId } from "@memorall/agent-harness-flows/context/runtime-context";
import { getScopedGraphWhere } from "../../utils/graph-query";
import { getCurrentEmbeddingFields } from "../../utils/embedding-size-config";
import {
	combineSearchResults,
	vectorSearchEdges,
	type FlowEmbeddingLike,
	type SearchWeights,
} from "../../utils/vector-search";

export const ACTIVE_MEMORY_ORIGIN = "active_memory";

export const MEMORY_KINDS = ["fact", "preference", "project_context"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

/**
 * Which facts a lookup is allowed to see.
 *
 * `active` is the write-side scope: only edges this agent saved through
 * `memory_remember`, which is what `memory_update` and `memory_remove` are
 * allowed to touch. `all` also sees facts the knowledge pipeline extracted from
 * ingested pages, files, and chats — those carry no `origin` attribute, so the
 * origin filter made an entire populated graph look empty to a reader.
 */
export const MEMORY_SCOPES = ["active", "all"] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/**
 * Vector candidates to pull per requested result.
 *
 * The similarity query cannot apply the origin/kind/current filters — those live
 * on columns the raw search does not select — so the ranked ids are re-filtered
 * against the same clauses as the text match. Over-fetching keeps that second
 * pass from starving when some of the nearest edges are filtered out.
 */
const VECTOR_CANDIDATE_MULTIPLIER = 3;

/**
 * Exact substring hits are a stronger signal than proximity when the caller
 * quotes a remembered phrase, so they keep a reserved share of the result set.
 * `combineSearchResults` hands the whole budget to whichever side is non-empty,
 * so a query that only matches semantically still fills the list.
 */
const MEMORY_SEARCH_WEIGHTS: SearchWeights = {
	sqlPercentage: 40,
	vectorPercentage: 60,
};

export type ActiveMemoryServices = Pick<AllServices, "database" | "embedding">;

export interface MemoryEdgeAttributes extends Record<string, unknown> {
	origin: typeof ACTIVE_MEMORY_ORIGIN;
	memoryKind: MemoryKind;
	createdBy: "agent";
	createdFrom: "conversation";
	createdAt: string;
	confidence?: number;
	tags?: string[];
	reason?: string;
	removedAt?: string;
	removedReason?: string;
	replacesEdgeId?: string;
	replacedByEdgeId?: string;
}

export interface MemoryFactResult {
	edge: Edge;
	sourceNode: Node;
	destinationNode: Node;
}

const normalizeNodeName = (name: string): string =>
	name.trim().replace(/\s+/g, " ");

export const resolveRuntimeGraphId = (
	context?: ToolExecutionContext,
): string | undefined => getRuntimeGraphId(context?.runtime);

export const normalizeMemoryKind = (memoryKind?: MemoryKind): MemoryKind =>
	memoryKind ?? "fact";

export const formatMemoryFact = (fact: MemoryFactResult): string => {
	const attributes =
		(fact.edge.attributes as Record<string, unknown> | null) ?? {};
	const kind = (attributes.memoryKind as string | undefined) ?? "fact";
	const status = fact.edge.isCurrent === false ? "inactive" : "current";
	// A reader needs to know which facts it may update or remove: only the ones
	// this agent saved itself are writable through the memory tools.
	const source =
		attributes.origin === ACTIVE_MEMORY_ORIGIN
			? ACTIVE_MEMORY_ORIGIN
			: "knowledge_graph";
	return [
		`id: ${fact.edge.id}`,
		`kind: ${kind}`,
		`source: ${source}`,
		`status: ${status}`,
		`fact: ${fact.edge.factText || `${fact.sourceNode.name} ${fact.edge.edgeType} ${fact.destinationNode.name}`}`,
		`relation: ${fact.sourceNode.name} -[${fact.edge.edgeType}]-> ${fact.destinationNode.name}`,
	]
		.filter(Boolean)
		.join("\n");
};

async function textToVector(
	embeddingService: IEmbeddingService,
	text: string,
): Promise<number[] | null> {
	try {
		const embedding = await embeddingService.get("default");
		if (!embedding?.isReady()) return null;
		return await embedding.textToVector(text);
	} catch {
		return null;
	}
}

export async function upsertMemoryNode(
	services: ActiveMemoryServices,
	input: {
		graphId?: string;
		name: string;
		nodeType: string;
		summary?: string;
		attributes?: Record<string, unknown>;
	},
): Promise<Node> {
	const name = normalizeNodeName(input.name);
	const nodeType = input.nodeType.trim() || "entity";

	return getKnowledgeDatabase(services.database).query(
		async ({ db, schema }) => {
			const existing = await db
				.select()
				.from(schema.nodes)
				.where(
					and(
						getScopedGraphWhere({ graphId: input.graphId }, schema.nodes.graph),
						eq(schema.nodes.name, name),
						eq(schema.nodes.nodeType, nodeType),
					),
				)
				.limit(1);

			if (existing[0]) {
				return existing[0];
			}

			const data: NewNode = {
				name,
				nodeType,
				summary: input.summary ?? null,
				attributes: input.attributes ?? {},
				graph: input.graphId ?? "",
			};

			const vector = await textToVector(services.embedding, name);
			if (vector) {
				const fields = await getCurrentEmbeddingFields();
				(data as Record<string, unknown>)[fields.nameEmbedding] = vector;
			}

			const [created] = await db.insert(schema.nodes).values(data).returning();
			return created;
		},
	);
}

export async function createMemoryEdge(
	services: ActiveMemoryServices,
	input: {
		graphId?: string;
		sourceId: string;
		destinationId: string;
		edgeType: string;
		factText: string;
		memoryKind: MemoryKind;
		validAt?: string;
		confidence?: number;
		tags?: string[];
		reason?: string;
		replacesEdgeId?: string;
	},
): Promise<Edge> {
	const now = new Date().toISOString();
	const attributes: MemoryEdgeAttributes = {
		origin: ACTIVE_MEMORY_ORIGIN,
		memoryKind: input.memoryKind,
		createdBy: "agent",
		createdFrom: "conversation",
		createdAt: now,
		...(typeof input.confidence === "number"
			? { confidence: input.confidence }
			: {}),
		...(input.tags?.length ? { tags: input.tags } : {}),
		...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
		...(input.replacesEdgeId ? { replacesEdgeId: input.replacesEdgeId } : {}),
	};

	const data: NewEdge = {
		sourceId: input.sourceId,
		destinationId: input.destinationId,
		edgeType: input.edgeType.trim(),
		factText: input.factText.trim(),
		validAt: input.validAt ? new Date(input.validAt) : undefined,
		recordedAt: new Date(),
		attributes,
		isCurrent: true,
		graph: input.graphId ?? "",
	};

	const factVector = await textToVector(services.embedding, input.factText);
	const typeVector = await textToVector(services.embedding, input.edgeType);
	if (factVector || typeVector) {
		const fields = await getCurrentEmbeddingFields();
		if (factVector) {
			(data as Record<string, unknown>)[fields.factEmbedding] = factVector;
		}
		if (typeVector) {
			(data as Record<string, unknown>)[fields.typeEmbedding] = typeVector;
		}
	}

	return getKnowledgeDatabase(services.database).query(
		async ({ db, schema }) => {
			const [created] = await db.insert(schema.edges).values(data).returning();
			return created;
		},
	);
}

export interface FindMemoryFactsInput {
	graphId?: string;
	query?: string;
	edgeId?: string;
	memoryKind?: MemoryKind;
	includeInactive?: boolean;
	limit?: number;
	scope?: MemoryScope;
}

/** `%` and `_` in a remembered phrase are literal text, not wildcards. */
const escapeLikePattern = (value: string): string =>
	value.replace(/[\\%_]/g, "\\$&");

const buildMemoryClauses = (
	schema: KnowledgeDatabaseSchema,
	input: FindMemoryFactsInput,
	scope: MemoryScope,
): SQL[] => {
	const clauses: SQL[] = [
		getScopedGraphWhere({ graphId: input.graphId }, schema.edges.graph),
	];

	if (scope === "active") {
		clauses.push(
			sql`${schema.edges.attributes}->>'origin' = ${ACTIVE_MEMORY_ORIGIN}`,
		);
	}
	if (!input.includeInactive) {
		clauses.push(eq(schema.edges.isCurrent, true));
	}
	if (input.edgeId) {
		clauses.push(eq(schema.edges.id, input.edgeId));
	}
	if (input.memoryKind) {
		clauses.push(
			sql`${schema.edges.attributes}->>'memoryKind' = ${input.memoryKind}`,
		);
	}

	return clauses;
};

/**
 * Nearest memory edges to the query text, as id → similarity.
 *
 * Saving a memory already embeds its fact text and relation type. Reading them
 * back matched on `LIKE` alone, so those vectors were written and never used and
 * a natural-language question could only find a memory by quoting it verbatim.
 * Failures stay soft: an embedding model that is not ready degrades this to the
 * text match rather than failing the tool call.
 */
async function searchMemoryEdgesByVector(
	services: ActiveMemoryServices,
	query: string,
	limit: number,
	graphId?: string,
): Promise<Map<string, number>> {
	try {
		const embedding = await services.embedding.get("default");
		if (!embedding?.isReady()) return new Map();

		const results = await vectorSearchEdges(
			services.database,
			embedding as FlowEmbeddingLike,
			[query],
			limit,
			graphId,
		);
		return new Map(
			results.map((result) => [String(result.item.id), result.similarity]),
		);
	} catch {
		return new Map();
	}
}

export async function findMemoryFacts(
	services: ActiveMemoryServices,
	input: FindMemoryFactsInput,
): Promise<MemoryFactResult[]> {
	const query = input.query?.trim();
	const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
	const scope = input.scope ?? "active";

	// Ranked ids are resolved first so the filtered row fetch below can apply the
	// same clauses to both halves of the search.
	const similarityById =
		query && !input.edgeId
			? await searchMemoryEdgesByVector(
					services,
					query,
					limit * VECTOR_CANDIDATE_MULTIPLIER,
					input.graphId,
				)
			: new Map<string, number>();

	const edges = await getKnowledgeDatabase(services.database).query<Edge[]>(
		async ({ db, schema }) => {
			const clauses = buildMemoryClauses(schema, input, scope);

			const textClause = query
				? or(
						ilike(schema.edges.factText, `%${escapeLikePattern(query)}%`),
						ilike(schema.edges.edgeType, `%${escapeLikePattern(query)}%`),
					)
				: undefined;

			const textMatches = (await db
				.select()
				.from(schema.edges)
				.where(and(...clauses, ...(textClause ? [textClause] : [])))
				.orderBy(desc(schema.edges.recordedAt))
				.limit(limit)) as Edge[];

			if (!similarityById.size) return textMatches;

			const vectorMatches = (await db
				.select()
				.from(schema.edges)
				.where(
					and(
						...clauses,
						inArray(schema.edges.id, Array.from(similarityById.keys())),
					),
				)
				.limit(limit)) as Edge[];

			return combineSearchResults(
				textMatches,
				vectorMatches
					.map((edge) => ({
						item: edge,
						similarity: similarityById.get(String(edge.id)) ?? 0,
					}))
					.sort((a, b) => b.similarity - a.similarity),
				MEMORY_SEARCH_WEIGHTS,
				limit,
				(edge) => String(edge.id),
			);
		},
	);

	const nodeIds = Array.from(
		new Set(
			edges
				.flatMap((edge) => [edge.sourceId, edge.destinationId])
				.filter(Boolean),
		),
	);
	if (!nodeIds.length) return [];

	const nodes = await getKnowledgeDatabase(services.database).query<Node[]>(
		async ({ db, schema }) =>
			db.select().from(schema.nodes).where(inArray(schema.nodes.id, nodeIds)),
	);
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));

	return edges.flatMap((edge) => {
		const sourceNode = nodeMap.get(edge.sourceId);
		const destinationNode = nodeMap.get(edge.destinationId);
		if (!sourceNode || !destinationNode) return [];
		return [{ edge, sourceNode, destinationNode }];
	});
}

export async function invalidateMemoryEdges(
	services: ActiveMemoryServices,
	facts: MemoryFactResult[],
	input: {
		reason?: string;
		replacedByEdgeId?: string;
	},
): Promise<number> {
	if (!facts.length) return 0;
	const now = new Date();
	const ids = facts.map((fact) => fact.edge.id);

	await getKnowledgeDatabase(services.database).query(
		async ({ db, schema }) => {
			for (const fact of facts) {
				const currentAttributes =
					(fact.edge.attributes as Record<string, unknown> | null) ?? {};
				const nextAttributes = {
					...currentAttributes,
					removedAt: now.toISOString(),
					...(input.reason?.trim()
						? { removedReason: input.reason.trim() }
						: {}),
					...(input.replacedByEdgeId
						? { replacedByEdgeId: input.replacedByEdgeId }
						: {}),
				};
				await db
					.update(schema.edges)
					.set({
						isCurrent: false,
						invalidAt: now,
						attributes: nextAttributes,
					})
					.where(eq(schema.edges.id, fact.edge.id));
			}
		},
	);

	return ids.length;
}
