import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { planStore, formatPlan } from "./store";
import type { Plan } from "./store";

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
	execute: async ({ title, items }) => {
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
		planStore.set(plan);
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
