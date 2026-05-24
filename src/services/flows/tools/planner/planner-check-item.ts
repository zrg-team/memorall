import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { planStore, formatPlan } from "./store";

const TOOL_NAME = "planner_check_item" as const;

const schema = z.object({
	item_id: z.string().describe("ID of the item to update (e.g. '1', '2')"),
	checked: z
		.boolean()
		.describe("Whether to mark the item as done (true) or not done (false)"),
	notes: z
		.string()
		.optional()
		.describe("Optional notes to attach to this item"),
});

type Input = z.infer<typeof schema>;

export const createPlannerCheckItemTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Mark a plan item as done or not done, optionally adding notes. Call this after completing each task.",
	schema,
	execute: async ({ item_id, checked, notes }) => {
		const plan = planStore.get();
		if (!plan) {
			return "No plan exists. Call planner_create first.";
		}
		const item = plan.items.find((i) => i.id === item_id);
		if (!item) {
			return `Item with id "${item_id}" not found. Available ids: ${plan.items.map((i) => i.id).join(", ")}.`;
		}
		item.checked = checked;
		if (notes !== undefined) {
			item.notes = notes;
		}
		plan.updatedAt = new Date().toISOString();
		planStore.set(plan);
		return formatPlan(plan);
	},
});

toolRegistry.register(TOOL_NAME, createPlannerCheckItemTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
