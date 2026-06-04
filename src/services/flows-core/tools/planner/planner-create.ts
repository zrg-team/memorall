import z from "zod";
import type {
	Tool,
	ToolFactory,
	ToolExecutionContext,
} from "flow-core/interfaces/engine/tool";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { setPlan, formatPlan } from "flow-core/tools/planner/store";
import type { Plan } from "flow-core/tools/planner/store";

const TOOL_NAME = "planner_create" as const;

const schema = z.object({
	title: z.string().describe("Short title of the plan"),
	items: z
		.string()
		.describe(
			'Plan items as a single string separated by semicolons. Example: "Inspect logs; patch planner_create; verify the fix"',
		),
});

type Input = z.infer<typeof schema>;

export const createPlannerCreateTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create a new plan with a title and semicolon-separated items string. Replaces any existing plan. Always call this first before starting work.",
	schema,
	execute: async ({ title, items }, context?: ToolExecutionContext) => {
		const descriptions = items
			.split(";")
			.map((item) => item.trim())
			.filter(Boolean);
		const now = new Date().toISOString();
		const plan: Plan = {
			title,
			items: descriptions.map((description, index) => ({
				id: String(index + 1),
				description,
				checked: false,
			})),
			createdAt: now,
			updatedAt: now,
		};
		setPlan(context?.runtime, plan);
		return formatPlan(plan);
	},
});

toolRegistry.register(TOOL_NAME, createPlannerCreateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
