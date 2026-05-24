import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	findMemoryFacts,
	invalidateMemoryEdges,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";

const TOOL_NAME = "memory_remove" as const;

const schema = z
	.object({
		edgeId: z.string().optional().describe("Exact memory edge id to remove"),
		query: z
			.string()
			.optional()
			.describe("Search query for memories to remove"),
		reason: z.string().optional().describe("Why the memory is being removed"),
		limit: z.number().int().min(1).max(20).optional(),
	})
	.refine((input) => Boolean(input.edgeId?.trim() || input.query?.trim()), {
		message: "Provide edgeId or query",
	});

type Input = z.infer<typeof schema>;

export const createMemoryRemoveTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Forget active memories in the currently selected memory graph by temporally invalidating them, not by deleting rows.",
	schema,
	execute: async (input, context) => {
		const facts = await findMemoryFacts(services, {
			graphId: resolveRuntimeGraphId(context),
			edgeId: input.edgeId,
			query: input.query,
			limit: input.limit ?? 5,
		});

		if (!facts.length) return "No active memories matched for removal.";
		const count = await invalidateMemoryEdges(services, facts, {
			reason: input.reason,
		});
		return `Removed ${count} memor${count === 1 ? "y" : "ies"} by marking them inactive.`;
	},
});

toolRegistry.register(TOOL_NAME, createMemoryRemoveTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: ActiveMemoryServices;
		};
	}
}
