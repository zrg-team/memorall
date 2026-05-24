import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	createMemoryEdge,
	findMemoryFacts,
	formatMemoryFact,
	invalidateMemoryEdges,
	MEMORY_KINDS,
	normalizeMemoryKind,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";
import { upsertMemoryNode } from "./shared";

const TOOL_NAME = "memory_update" as const;

const schema = z
	.object({
		edgeId: z.string().optional().describe("Exact memory edge id to update"),
		query: z.string().optional().describe("Search query for memory to update"),
		subject: z.string().min(1),
		subjectType: z.string().optional(),
		relation: z.string().min(1),
		object: z.string().min(1),
		objectType: z.string().optional(),
		factText: z.string().min(1),
		memoryKind: z.enum(MEMORY_KINDS).optional(),
		confidence: z.number().min(0).max(1).optional(),
		tags: z.array(z.string()).optional(),
		reason: z.string().optional(),
	})
	.refine((input) => Boolean(input.edgeId?.trim() || input.query?.trim()), {
		message: "Provide edgeId or query to identify the memory to update",
	});

type Input = z.infer<typeof schema>;

export const createMemoryUpdateTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Update a memory in the currently selected memory graph by invalidating the old fact and creating a replacement.",
	schema,
	execute: async (input, context) => {
		const graphId = resolveRuntimeGraphId(context);
		const existing = await findMemoryFacts(services, {
			graphId,
			edgeId: input.edgeId,
			query: input.query,
			limit: 1,
		});
		const previous = existing[0];
		if (!previous) return "No active memory matched for update.";

		const sourceNode = await upsertMemoryNode(services, {
			graphId,
			name: input.subject,
			nodeType: input.subjectType ?? "entity",
		});
		const destinationNode = await upsertMemoryNode(services, {
			graphId,
			name: input.object,
			nodeType: input.objectType ?? "value",
		});
		const edge = await createMemoryEdge(services, {
			graphId,
			sourceId: sourceNode.id,
			destinationId: destinationNode.id,
			edgeType: input.relation,
			factText: input.factText,
			memoryKind: normalizeMemoryKind(input.memoryKind),
			confidence: input.confidence,
			tags: input.tags,
			reason: input.reason,
			replacesEdgeId: previous.edge.id,
		});
		await invalidateMemoryEdges(services, [previous], {
			reason: input.reason,
			replacedByEdgeId: edge.id,
		});

		return `Updated memory:\n${formatMemoryFact({
			edge,
			sourceNode,
			destinationNode,
		})}`;
	},
});

toolRegistry.register(TOOL_NAME, createMemoryUpdateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: ActiveMemoryServices;
		};
	}
}
