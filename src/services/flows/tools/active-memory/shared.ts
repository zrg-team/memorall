import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { AllServices, ToolExecutionContext } from "../../interfaces/tool";
import type { Edge, NewEdge, NewNode, Node } from "../../interfaces/knowledge";
import type { IEmbeddingService } from "../../interfaces/embedding";
import { getRuntimeGraphId } from "../../runtime/runtime-context";
import { getScopedGraphWhere } from "../../utils/graph-query";
import { getCurrentEmbeddingFields } from "../../utils/embedding-size-config";

export const ACTIVE_MEMORY_ORIGIN = "active_memory";

export const MEMORY_KINDS = ["fact", "preference", "project_context"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

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
	const kind =
		((fact.edge.attributes as Record<string, unknown> | null)?.memoryKind as
			| string
			| undefined) ?? "fact";
	const status = fact.edge.isCurrent === false ? "inactive" : "current";
	return [
		`id: ${fact.edge.id}`,
		`kind: ${kind}`,
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

export async function findMemoryFacts(
	services: ActiveMemoryServices,
	input: {
		graphId?: string;
		query?: string;
		edgeId?: string;
		memoryKind?: MemoryKind;
		includeInactive?: boolean;
		limit?: number;
	},
): Promise<MemoryFactResult[]> {
	const query = input.query?.trim();
	const limit = Math.max(1, Math.min(input.limit ?? 10, 50));

	const edges = await getKnowledgeDatabase(services.database).query<Edge[]>(
		async ({ db, schema }) => {
			const clauses = [
				getScopedGraphWhere({ graphId: input.graphId }, schema.edges.graph),
				sql`${schema.edges.attributes}->>'origin' = ${ACTIVE_MEMORY_ORIGIN}`,
			];

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
			if (query) {
				const queryClause = or(
					like(schema.edges.factText, `%${query}%`),
					like(schema.edges.edgeType, `%${query}%`),
				);
				if (queryClause) clauses.push(queryClause);
			}

			return db
				.select()
				.from(schema.edges)
				.where(and(...clauses))
				.orderBy(desc(schema.edges.recordedAt))
				.limit(limit);
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
