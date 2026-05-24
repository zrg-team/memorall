import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	findMemoryFacts,
	formatMemoryFact,
	MEMORY_KINDS,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";

const TOOL_NAME = "memory_retrieve" as const;

const schema = z.object({
	query: z.string().min(1).describe("What memory to search for"),
	memoryKind: z.enum(MEMORY_KINDS).optional(),
	includeInactive: z.boolean().optional(),
	limit: z.number().int().min(1).max(50).optional(),
});

type Input = z.infer<typeof schema>;

export const createMemoryRetrieveTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Retrieve active memories from the currently selected memory graph. Inactive/forgotten memories are excluded unless includeInactive is true.",
	schema,
	execute: async (input, context) => {
		const facts = await findMemoryFacts(services, {
			graphId: resolveRuntimeGraphId(context),
			query: input.query,
			memoryKind: input.memoryKind,
			includeInactive: input.includeInactive,
			limit: input.limit,
		});

		if (!facts.length) return "No matching memories found.";
		return facts.map(formatMemoryFact).join("\n\n---\n\n");
	},
});

toolRegistry.register(TOOL_NAME, createMemoryRetrieveTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: ActiveMemoryServices;
		};
	}
}
