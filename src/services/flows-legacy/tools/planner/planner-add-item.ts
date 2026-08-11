import z from "zod";
import type {
	Tool,
	ToolFactory,
	ToolExecutionContext,
} from "@/services/flows-legacy/interfaces/engine/tool";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import {
	getPlan,
	setPlan,
	formatPlan,
} from "@/services/flows-legacy/tools/planner/store";

const TOOL_NAME = "planner_add_item" as const;

const schema = z.object({
	description: z.string().describe("Description of the new item to add"),
});

type Input = z.infer<typeof schema>;

export const createPlannerAddItemTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Add a new unchecked item to the current plan. Use this when you discover additional work that needs to be done.",
	schema,
	execute: async ({ description }, context?: ToolExecutionContext) => {
		const plan = getPlan(context?.runtime);
		if (!plan) {
			return "No plan exists. Call planner_create first.";
		}
		const nextId = String(
			Math.max(0, ...plan.items.map((i) => Number(i.id))) + 1,
		);
		plan.items.push({ id: nextId, description, checked: false });
		plan.updatedAt = new Date().toISOString();
		setPlan(context?.runtime, plan);
		return formatPlan(plan);
	},
});

toolRegistry.register(TOOL_NAME, createPlannerAddItemTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
