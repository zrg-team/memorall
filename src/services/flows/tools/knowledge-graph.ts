import { getKnowledgeDatabase } from "../interfaces/knowledge";
import z from "zod";
import { and, eq, inArray, like, or } from "drizzle-orm";
import type { Tool, ToolFactory, AllServices } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import {
	combineSearchResults,
	vectorSearchEdges,
	vectorSearchNodes,
} from "../utils/vector-search";
import { getScopedGraphWhere } from "../utils/graph-query";
import type { Edge, Node } from "../interfaces/knowledge";

const TOOL_NAME = "knowledge_graph" as const;

const schema = z
	.object({
		query: z.string().optional().describe("Primary knowledge query"),
		queries: z
			.array(z.string())
			.optional()
			.describe("Additional knowledge retrieval queries"),
		entity: z
			.string()
			.optional()
			.describe("Entity alias for backward compatibility"),
		relationship: z
			.string()
			.optional()
			.describe("Specific relationship type to filter edges"),
		graphId: z
			.string()
			.optional()
			.describe("Knowledge graph/topic id to scope retrieval"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(20)
			.describe("Result limit"),
	})
	.refine(
		(input) => {
			const terms = [input.query, input.entity, ...(input.queries ?? [])]
				.map((term) => term?.trim())
				.filter((term): term is string => Boolean(term));
			return terms.length > 0;
		},
		{
			message:
				"At least one query term is required (query, entity, or queries[])",
		},
	);

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "embedding" | "database">;

const normalizeQueries = (input: Input): string[] => {
	const merged = [input.query, input.entity, ...(input.queries ?? [])]
		.map((value) => value?.trim())
		.filter((value): value is string => Boolean(value));
	return Array.from(new Set(merged));
};

const buildKnowledgeContext = (nodes: Node[], edges: Edge[]): string => {
	if (!nodes.length || !edges.length) {
		return "";
	}

	const definitions = nodes
		.map(
			(node) =>
				`"${node.name}" (${node.nodeType || "Unknow"}): ${node.summary || ""}.`,
		)
		.join("\n");

	const facts = edges
		.map((edge) => {
			const sourceName =
				nodes.find((node) => node.id === edge.sourceId)?.name || "Unknown";
			const destinationName =
				nodes.find((node) => node.id === edge.destinationId)?.name || "Unknown";
			return `"${sourceName}" ${edge.edgeType} "${destinationName}", ${edge.factText || ""}.`;
		})
		.join("\n");

	return `
${definitions.trim() ? `<definitions>${definitions}</definitions>` : ""}
${facts.trim() ? `<facts>${facts}</facts>` : ""}`;
};

export const createKnowledgeGraphTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Retrieve nodes and edges from the knowledge graph using one or more queries, optionally scoped by graphId",
	schema,
	execute: async (input) => {
		const queries = normalizeQueries(input);
		const graphId = input.graphId?.trim() || undefined;
		const relationship = input.relationship?.trim();
		const limit = input.limit ?? 20;

		const embedding = await services.embedding.get("default");
		const canUseVectorSearch = Boolean(embedding && embedding.isReady());

		let vectorNodeResults: Awaited<ReturnType<typeof vectorSearchNodes>> = [];
		let vectorEdgeResults: Awaited<ReturnType<typeof vectorSearchEdges>> = [];

		if (canUseVectorSearch && embedding) {
			vectorNodeResults = await vectorSearchNodes(
				services.database,
				embedding,
				queries,
				Math.max(1, Math.floor(limit * 0.6)),
				graphId,
			);

			vectorEdgeResults = await vectorSearchEdges(
				services.database,
				embedding,
				queries,
				Math.max(1, Math.floor(limit * 0.6)),
				graphId,
			);
		}

		const sqlResult = await getKnowledgeDatabase(services.database).query(
			async ({ db, schema }) => {
				const nodeTextClauses = queries.flatMap((term) => [
					like(schema.nodes.name, `%${term}%`),
					like(schema.nodes.summary, `%${term}%`),
				]);

				const edgeTextClauses = queries.flatMap((term) => [
					like(schema.edges.edgeType, `%${term}%`),
					like(schema.edges.factText, `%${term}%`),
				]);

				const nodeWhere = and(
					getScopedGraphWhere({ graphId }, schema.nodes.graph),
					or(...nodeTextClauses),
				);

				const edgeWhere = relationship
					? and(
							getScopedGraphWhere({ graphId }, schema.edges.graph),
							eq(schema.edges.edgeType, relationship),
							or(...edgeTextClauses),
						)
					: and(
							getScopedGraphWhere({ graphId }, schema.edges.graph),
							or(...edgeTextClauses),
						);

				const sqlNodes = await db
					.select()
					.from(schema.nodes)
					.where(nodeWhere)
					.limit(limit);

				const sqlEdges = await db
					.select()
					.from(schema.edges)
					.where(edgeWhere)
					.limit(limit);

				return { sqlNodes, sqlEdges };
			},
		);

		const mergedNodes = combineSearchResults(
			sqlResult.sqlNodes,
			vectorNodeResults,
			{
				sqlPercentage: canUseVectorSearch ? 40 : 100,
				vectorPercentage: canUseVectorSearch ? 60 : 0,
			},
			limit,
			(node) => node.id,
		);

		const mergedEdges = combineSearchResults(
			sqlResult.sqlEdges,
			vectorEdgeResults,
			{
				sqlPercentage: canUseVectorSearch ? 40 : 100,
				vectorPercentage: canUseVectorSearch ? 60 : 0,
			},
			limit,
			(edge) => edge.id,
		).filter((edge) => !relationship || edge.edgeType === relationship);

		const relatedNodeIds = Array.from(
			new Set(
				[
					...mergedEdges.map((edge) => edge.sourceId),
					...mergedEdges.map((edge) => edge.destinationId),
				].filter((id): id is string => Boolean(id)),
			),
		);

		const relatedNodes = relatedNodeIds.length
			? await getKnowledgeDatabase(services.database).query<Node[]>(
					async ({ db, schema }) =>
						db
							.select()
							.from(schema.nodes)
							.where(inArray(schema.nodes.id, relatedNodeIds)),
				)
			: [];

		const mergedNodeMap = new Map<string, Node>();
		mergedNodes.forEach((node) => mergedNodeMap.set(node.id, node));
		relatedNodes.forEach((node) => {
			if (!mergedNodeMap.has(node.id)) {
				mergedNodeMap.set(node.id, node);
			}
		});

		return buildKnowledgeContext(
			Array.from(mergedNodeMap.values()),
			mergedEdges,
		);
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createKnowledgeGraphTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
