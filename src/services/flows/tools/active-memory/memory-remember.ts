import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	createMemoryEdge,
	formatMemoryFact,
	MEMORY_KINDS,
	normalizeMemoryKind,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";
import { upsertMemoryNode } from "./shared";

const TOOL_NAME = "memory_remember" as const;

const schema = z.object({
	subject: z.string().min(1).describe("The entity this memory is about"),
	subjectType: z.string().optional().describe("Type of the subject entity"),
	relation: z.string().min(1).describe("Relationship or predicate"),
	object: z.string().min(1).describe("The target/value of the memory"),
	objectType: z.string().optional().describe("Type of the object entity"),
	factText: z.string().min(1).describe("Natural-language fact to remember"),
	memoryKind: z.enum(MEMORY_KINDS).optional(),
	validAt: z.string().optional().describe("Optional ISO timestamp when valid"),
	confidence: z.number().min(0).max(1).optional(),
	tags: z.array(z.string()).optional(),
	reason: z.string().optional().describe("Why this memory is being saved"),
});

type Input = z.infer<typeof schema>;

export const createMemoryRememberTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Remember a durable user fact, preference, or project-context item in the currently selected memory graph.",
	schema,
	execute: async (input, context) => {
		const graphId = resolveRuntimeGraphId(context);
		const memoryKind = normalizeMemoryKind(input.memoryKind);
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
			memoryKind,
			validAt: input.validAt,
			confidence: input.confidence,
			tags: input.tags,
			reason: input.reason,
		});

		return `Remembered memory:\n${formatMemoryFact({
			edge,
			sourceNode,
			destinationNode,
		})}`;
	},
});

toolRegistry.register(TOOL_NAME, createMemoryRememberTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: ActiveMemoryServices;
		};
	}
}
