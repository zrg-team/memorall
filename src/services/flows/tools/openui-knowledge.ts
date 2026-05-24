import { getKnowledgeDatabase } from "../interfaces/knowledge";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import type {
	AllServices,
	Tool,
	ToolExecutionContext,
	ToolFactory,
} from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import { getRuntimeGraphId } from "../runtime/runtime-context";
import { getScopedGraphWhere } from "../utils/graph-query";
import type { Edge, Node } from "../interfaces/knowledge";

export const OPENUI_KNOWLEDGE_TOOLS = [
	"search_knowledge",
	"get_entity",
	"get_topic_facts",
	"get_recent_entities",
] as const;

type OpenUIKnowledgeServices = Pick<AllServices, "database" | "embedding">;

const optionalGraphIdSchema = z
	.string()
	.optional()
	.describe("Optional graph/topic id. Omit to use the current selected topic.");

const limitSchema = z.number().int().min(1).max(50).default(10);

const resolveGraphId = (
	inputGraphId: string | undefined,
	context?: ToolExecutionContext,
) => inputGraphId?.trim() || getRuntimeGraphId(context?.runtime);

const toJson = (value: unknown) => JSON.stringify(value, null, 2);

const getNodeType = (node: Node) => node.nodeType || "Entity";

const getNodeSummary = (node: Node) => node.summary ?? "";

const formatDate = (date: Date | string | null | undefined) =>
	date ? new Date(date).toISOString() : undefined;

const fetchNodesByIds = async (
	services: OpenUIKnowledgeServices,
	nodeIds: string[],
) => {
	if (!nodeIds.length) return new Map<string, Node>();
	const nodes = await getKnowledgeDatabase(services.database).query<Node[]>(
		async ({ db, schema }) =>
			db.select().from(schema.nodes).where(inArray(schema.nodes.id, nodeIds)),
	);
	return new Map(nodes.map((node) => [node.id, node]));
};

const edgeToFact = (edge: Edge, nodeMap: Map<string, Node>) => {
	const source = nodeMap.get(edge.sourceId);
	const destination = nodeMap.get(edge.destinationId);
	return {
		subject: source?.name ?? "Unknown",
		predicate: edge.edgeType,
		object: destination?.name ?? "Unknown",
		date: formatDate(edge.validAt ?? edge.recordedAt),
		text:
			edge.factText ||
			`${source?.name ?? "Unknown"} ${edge.edgeType} ${destination?.name ?? "Unknown"}`,
	};
};

const searchKnowledgeSchema = z.object({
	query: z
		.string()
		.min(1)
		.describe("Search query for entity names or summaries"),
	limit: limitSchema,
	graphId: optionalGraphIdSchema,
});

type SearchKnowledgeInput = z.infer<typeof searchKnowledgeSchema>;

export const createSearchKnowledgeTool: ToolFactory<
	SearchKnowledgeInput,
	OpenUIKnowledgeServices
> = (services): Tool<SearchKnowledgeInput> => ({
	name: "search_knowledge",
	description:
		"Search knowledge graph entities by name, type, or summary. Returns compact entity rows for visualization.",
	schema: searchKnowledgeSchema,
	execute: async (input, context) => {
		const query = input.query.trim();
		const graphId = resolveGraphId(input.graphId, context);
		const nodes = await getKnowledgeDatabase(services.database).query<Node[]>(
			async ({ db, schema }) =>
				db
					.select()
					.from(schema.nodes)
					.where(
						and(
							getScopedGraphWhere({ graphId }, schema.nodes.graph),
							or(
								like(schema.nodes.name, `%${query}%`),
								like(schema.nodes.nodeType, `%${query}%`),
								like(schema.nodes.summary, `%${query}%`),
							),
						),
					)
					.orderBy(desc(schema.nodes.updatedAt))
					.limit(input.limit),
		);

		return toJson(
			nodes.map((node) => ({
				id: node.id,
				name: node.name,
				type: getNodeType(node),
				summary: getNodeSummary(node),
			})),
		);
	},
});

const getEntitySchema = z
	.object({
		id: z.string().optional().describe("Entity id"),
		name: z.string().optional().describe("Entity name when id is unknown"),
		graphId: optionalGraphIdSchema,
	})
	.refine((input) => Boolean(input.id?.trim() || input.name?.trim()), {
		message: "Provide id or name.",
	});

type GetEntityInput = z.infer<typeof getEntitySchema>;

export const createGetEntityTool: ToolFactory<
	GetEntityInput,
	OpenUIKnowledgeServices
> = (services): Tool<GetEntityInput> => ({
	name: "get_entity",
	description:
		"Get full details for one knowledge entity, including facts and related entities.",
	schema: getEntitySchema,
	execute: async (input, context) => {
		const graphId = resolveGraphId(input.graphId, context);
		const [node] = await getKnowledgeDatabase(services.database).query<Node[]>(
			async ({ db, schema }) =>
				db
					.select()
					.from(schema.nodes)
					.where(
						and(
							getScopedGraphWhere({ graphId }, schema.nodes.graph),
							input.id?.trim()
								? eq(schema.nodes.id, input.id.trim())
								: eq(schema.nodes.name, input.name?.trim() ?? ""),
						),
					)
					.limit(1),
		);

		if (!node) {
			return toJson({ error: "Entity not found" });
		}

		const edges = await getKnowledgeDatabase(services.database).query<Edge[]>(
			async ({ db, schema }) =>
				db
					.select()
					.from(schema.edges)
					.where(
						and(
							getScopedGraphWhere({ graphId }, schema.edges.graph),
							eq(schema.edges.isCurrent, true),
							or(
								eq(schema.edges.sourceId, node.id),
								eq(schema.edges.destinationId, node.id),
							),
						),
					)
					.orderBy(desc(schema.edges.recordedAt))
					.limit(50),
		);

		const relatedIds = Array.from(
			new Set(
				edges
					.flatMap((edge) => [edge.sourceId, edge.destinationId])
					.filter((id) => id !== node.id),
			),
		);
		const nodeMap = await fetchNodesByIds(services, [node.id, ...relatedIds]);
		const facts = edges.map((edge) => edgeToFact(edge, nodeMap));

		return toJson({
			id: node.id,
			name: node.name,
			type: getNodeType(node),
			summary: getNodeSummary(node),
			facts: facts.map((fact) => fact.text),
			factTriples: facts.map(({ subject, predicate, object, date }) => ({
				subject,
				predicate,
				object,
				date,
			})),
			relatedEntities: relatedIds
				.map((id) => nodeMap.get(id))
				.filter((related): related is Node => Boolean(related))
				.map((related) => ({
					id: related.id,
					name: related.name,
					type: getNodeType(related),
					summary: getNodeSummary(related),
				})),
		});
	},
});

const getTopicFactsSchema = z.object({
	topic: z
		.string()
		.optional()
		.describe("Topic, entity, or concept to filter facts by"),
	limit: limitSchema,
	graphId: optionalGraphIdSchema,
});

type GetTopicFactsInput = z.infer<typeof getTopicFactsSchema>;

export const createGetTopicFactsTool: ToolFactory<
	GetTopicFactsInput,
	OpenUIKnowledgeServices
> = (services): Tool<GetTopicFactsInput> => ({
	name: "get_topic_facts",
	description:
		"Get fact triples for a topic or for the current selected knowledge graph.",
	schema: getTopicFactsSchema,
	execute: async (input, context) => {
		const graphId = resolveGraphId(input.graphId, context);
		const topic = input.topic?.trim();
		const matchingNodeIds = topic
			? await getKnowledgeDatabase(services.database).query<string[]>(
					async ({ db, schema }) => {
						const nodes: Array<{ id: string }> = await db
							.select({ id: schema.nodes.id })
							.from(schema.nodes)
							.where(
								and(
									getScopedGraphWhere({ graphId }, schema.nodes.graph),
									or(
										like(schema.nodes.name, `%${topic}%`),
										like(schema.nodes.summary, `%${topic}%`),
									),
								),
							)
							.limit(50);
						return nodes.map((node) => node.id);
					},
				)
			: [];

		const edges = await getKnowledgeDatabase(services.database).query<Edge[]>(
			async ({ db, schema }) =>
				db
					.select()
					.from(schema.edges)
					.where(
						and(
							getScopedGraphWhere({ graphId }, schema.edges.graph),
							eq(schema.edges.isCurrent, true),
							topic
								? or(
										like(schema.edges.factText, `%${topic}%`),
										like(schema.edges.edgeType, `%${topic}%`),
										...(matchingNodeIds.length
											? [
													inArray(schema.edges.sourceId, matchingNodeIds),
													inArray(schema.edges.destinationId, matchingNodeIds),
												]
											: []),
									)
								: undefined,
						),
					)
					.orderBy(desc(schema.edges.recordedAt))
					.limit(input.limit),
		);

		const nodeIds = Array.from(
			new Set(edges.flatMap((edge) => [edge.sourceId, edge.destinationId])),
		);
		const nodeMap = await fetchNodesByIds(services, nodeIds);

		return toJson(
			edges.map((edge) => {
				const fact = edgeToFact(edge, nodeMap);
				return {
					subject: fact.subject,
					predicate: fact.predicate,
					object: fact.object,
					date: fact.date,
				};
			}),
		);
	},
});

const getRecentEntitiesSchema = z.object({
	limit: limitSchema,
	graphId: optionalGraphIdSchema,
});

type GetRecentEntitiesInput = z.infer<typeof getRecentEntitiesSchema>;

export const createGetRecentEntitiesTool: ToolFactory<
	GetRecentEntitiesInput,
	OpenUIKnowledgeServices
> = (services): Tool<GetRecentEntitiesInput> => ({
	name: "get_recent_entities",
	description:
		"Get recently saved or updated entities from the current selected knowledge graph.",
	schema: getRecentEntitiesSchema,
	execute: async (input, context) => {
		const graphId = resolveGraphId(input.graphId, context);
		const nodes = await getKnowledgeDatabase(services.database).query<Node[]>(
			async ({ db, schema }) =>
				db
					.select()
					.from(schema.nodes)
					.where(getScopedGraphWhere({ graphId }, schema.nodes.graph))
					.orderBy(desc(schema.nodes.updatedAt))
					.limit(input.limit),
		);

		return toJson(
			nodes.map((node) => ({
				id: node.id,
				name: node.name,
				type: getNodeType(node),
				summary: getNodeSummary(node),
				savedAt: formatDate(node.createdAt),
				updatedAt: formatDate(node.updatedAt),
			})),
		);
	},
});

toolRegistry.register("search_knowledge", createSearchKnowledgeTool);
toolRegistry.register("get_entity", createGetEntityTool);
toolRegistry.register("get_topic_facts", createGetTopicFactsTool);
toolRegistry.register("get_recent_entities", createGetRecentEntitiesTool);

declare global {
	interface ToolTypeRegistry {
		search_knowledge: {
			input: SearchKnowledgeInput;
			services: OpenUIKnowledgeServices;
		};
		get_entity: {
			input: GetEntityInput;
			services: OpenUIKnowledgeServices;
		};
		get_topic_facts: {
			input: GetTopicFactsInput;
			services: OpenUIKnowledgeServices;
		};
		get_recent_entities: {
			input: GetRecentEntitiesInput;
			services: OpenUIKnowledgeServices;
		};
	}
}
