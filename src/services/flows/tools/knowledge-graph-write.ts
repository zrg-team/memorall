import { getKnowledgeDatabase } from "../interfaces/knowledge";
import z from "zod";
import { eq } from "drizzle-orm";
import type { Tool, ToolFactory, AllServices } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import { getCurrentEmbeddingFields } from "../utils/embedding-size-config";
import type { IEmbeddingService } from "../interfaces/embedding";
import type {
	KnowledgeDatabaseClient,
	KnowledgeDatabaseTables,
} from "../interfaces/knowledge";
import type { NewNode } from "../interfaces/knowledge";
import type { NewEdge } from "../interfaces/knowledge";

const TOOL_NAME = "knowledge_graph_write" as const;

const schema = z
	.object({
		graphId: z.string().optional().describe("Graph/topic scope"),
		node: z
			.object({
				name: z.string(),
				nodeType: z.string(),
				summary: z.string().optional(),
				attributes: z.record(z.string(), z.unknown()).optional(),
			})
			.optional()
			.describe("Node to create or update by name"),
		edges: z
			.array(
				z.object({
					sourceName: z
						.string()
						.optional()
						.describe("Source node name — omit to use the input node"),
					destinationName: z
						.string()
						.optional()
						.describe("Destination node name — omit to use the input node"),
					edgeType: z.string(),
					factText: z.string().optional(),
				}),
			)
			.optional()
			.describe(
				"Facts/edges linking two nodes by name. Omit sourceName or destinationName to use the input node.",
			),
	})
	.refine((input) => input.node || (input.edges?.length ?? 0) > 0, {
		message: "Provide a node or at least one edge",
	});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "embedding" | "database">;

async function toVector(
	embedding: IEmbeddingService,
	text: string,
): Promise<number[] | null> {
	try {
		const model = await embedding.get("default");
		if (!model?.isReady()) return null;
		return await model.textToVector(text);
	} catch {
		return null;
	}
}

export const createKnowledgeGraphWriteTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Write nodes and edges to the knowledge graph. Nodes are upserted by name. Edges link two nodes by name.",
	schema,
	execute: async (input) => {
		const graphId = input.graphId?.trim() ?? "";
		const fields = await getCurrentEmbeddingFields();

		const results: string[] = [];
		const errors: string[] = [];

		// ── Nodes ────────────────────────────────────────────────────────────────
		const nameToId = new Map<string, string>();

		for (const node of input.node ? [input.node] : []) {
			try {
				await getKnowledgeDatabase(services.database).query(
					async ({ db, schema: s }) => {
						const nameVec = await toVector(services.embedding, node.name);

						const data: NewNode = {
							nodeType: node.nodeType,
							name: node.name,
							summary: node.summary ?? null,
							attributes: node.attributes ?? {},
							graph: graphId,
						};
						if (nameVec)
							(data as Record<string, unknown>)[fields.nameEmbedding] = nameVec;

						const existing = await db
							.select({ id: s.nodes.id })
							.from(s.nodes)
							.where(eq(s.nodes.name, node.name))
							.limit(1);

						if (existing.length > 0) {
							await db
								.update(s.nodes)
								.set(data)
								.where(eq(s.nodes.id, existing[0].id));
							nameToId.set(node.name, existing[0].id);
							results.push(`Updated node "${node.name}"`);
						} else {
							const [created] = await db
								.insert(s.nodes)
								.values(data)
								.returning({ id: s.nodes.id });
							nameToId.set(node.name, created.id);
							results.push(`Created node "${node.name}"`);
						}
					},
				);
			} catch (e) {
				errors.push(
					`Node "${node.name}": ${e instanceof Error ? e.message : e}`,
				);
			}
		}

		// ── Edges ────────────────────────────────────────────────────────────────
		const resolveNodeId = async (
			name: string,
			db: KnowledgeDatabaseClient,
			s: KnowledgeDatabaseTables,
		): Promise<string | undefined> => {
			const cached = nameToId.get(name);
			if (cached) return cached;
			const row = await db
				.select({ id: s.nodes.id })
				.from(s.nodes)
				.where(eq(s.nodes.name, name))
				.limit(1);
			return row[0]?.id;
		};

		for (const edge of input.edges ?? []) {
			try {
				await getKnowledgeDatabase(services.database).query(
					async ({ db, schema: s }) => {
						const sourceName = edge.sourceName ?? input.node?.name;
						const destName = edge.destinationName ?? input.node?.name;

						if (!sourceName)
							throw new Error(
								"sourceName is required when no input node is provided",
							);
						if (!destName)
							throw new Error(
								"destinationName is required when no input node is provided",
							);

						const sourceId = await resolveNodeId(sourceName, db, s);
						if (!sourceId) throw new Error(`Node not found: "${sourceName}"`);

						const destId = await resolveNodeId(destName, db, s);
						if (!destId) throw new Error(`Node not found: "${destName}"`);

						const factVec = edge.factText
							? await toVector(services.embedding, edge.factText)
							: null;
						const typeVec = await toVector(services.embedding, edge.edgeType);

						const data: NewEdge = {
							sourceId,
							destinationId: destId,
							edgeType: edge.edgeType,
							factText: edge.factText ?? null,
							graph: graphId,
							recordedAt: new Date(),
						};
						if (factVec)
							(data as Record<string, unknown>)[fields.factEmbedding] = factVec;
						if (typeVec)
							(data as Record<string, unknown>)[fields.typeEmbedding] = typeVec;

						await db.insert(s.edges).values(data);
						results.push(
							`Created edge "${sourceName}" -[${edge.edgeType}]-> "${destName}"`,
						);
					},
				);
			} catch (e) {
				errors.push(
					`Edge ${edge.sourceName ?? input.node?.name} → ${edge.destinationName ?? input.node?.name}: ${e instanceof Error ? e.message : e}`,
				);
			}
		}

		return (
			[...results, ...errors.map((e) => `Error: ${e}`)].join("\n") ||
			"No changes."
		);
	},
});

toolRegistry.register(TOOL_NAME, createKnowledgeGraphWriteTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
