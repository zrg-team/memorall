import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { planStore, formatPlan } from "./store";

const TOOL_NAME = "planner_get" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;

export const createPlannerGetTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Get the current plan and its completion status. Call this before giving any final response to verify all items are complete.",
	schema,
	execute: async () => {
		const plan = planStore.get();
		if (!plan) {
			return "No plan exists. Call planner_create to start a plan.";
		}
		return formatPlan(plan);
	},
});

toolRegistry.register(TOOL_NAME, createPlannerGetTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
