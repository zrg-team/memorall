import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { planStore, formatPlan } from "./store";

const TOOL_NAME = "planner_remove_item" as const;

const schema = z.object({
	item_id: z.string().describe("ID of the item to remove (e.g. '1', '2')"),
});

type Input = z.infer<typeof schema>;

export const createPlannerRemoveItemTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Remove an item from the current plan. Use this when a task is no longer relevant.",
	schema,
	execute: async ({ item_id }) => {
		const plan = planStore.get();
		if (!plan) {
			return "No plan exists. Call planner_create first.";
		}
		const index = plan.items.findIndex((i) => i.id === item_id);
		if (index === -1) {
			return `Item with id "${item_id}" not found. Available ids: ${plan.items.map((i) => i.id).join(", ")}.`;
		}
		plan.items.splice(index, 1);
		plan.updatedAt = new Date().toISOString();
		planStore.set(plan);
		return formatPlan(plan);
	},
});

toolRegistry.register(TOOL_NAME, createPlannerRemoveItemTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
