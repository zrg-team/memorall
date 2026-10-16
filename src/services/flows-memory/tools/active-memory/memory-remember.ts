import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	createMemoryEdge,
	formatMemoryFact,
	MEMORY_FACT_FIELDS,
	normalizeMemoryKind,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";
import { upsertMemoryNode } from "./shared";

const TOOL_NAME = "memory_remember" as const;

const schema = z.object({
	...MEMORY_FACT_FIELDS,
	validAt: z.string().optional().describe("Optional ISO timestamp when valid"),
});

type Input = z.infer<typeof schema>;

export const createMemoryRememberTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		'Remember a durable user fact, preference, or project-context item in the currently selected memory graph. Give it as subject → relation → object plus the full sentence, e.g. subject "user", relation "prefers", object "dark mode", factText "The user prefers dark mode."',
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
