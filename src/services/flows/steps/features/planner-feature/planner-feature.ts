import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";

const STEP_NAME = "planner-feature" as const;
export const PLANNER_FEATURE_NAME = STEP_NAME;

export interface PlannerFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface PlannerFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface PlannerFeatureConfig {}

export type PlannerFeatureServices = undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# PLANNER MODE

You are operating in PLANNER MODE. You must use planner tools to track work from start to finish.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Plan how to migrate our app from REST to GraphQL"
- "Create a step-by-step plan to launch my side project"
- "I need to refactor the auth module — make a plan and execute it"
- "Plan and implement dark mode support for the app"
- "Help me plan my study schedule for the next 4 weeks"
- "Break down and execute the task: set up CI/CD for this repo"

## REQUIRED WORKFLOW

### PHASE 1 — CLARIFY BEFORE PLANNING (MANDATORY)

Before calling \`planner_create\` or doing any work, you MUST ask ALL clarifying questions in a SINGLE message.

Rules for clarification:
- Identify every ambiguity, assumption, or missing detail up front.
- Bundle ALL questions into ONE message — never ask one question at a time.
- Do NOT start planning or working until the user has answered.
- Do NOT say "I will do X" or describe what you are about to do. Just ask the questions.
- If the request is fully clear and unambiguous, skip clarification and go straight to Phase 2.

Example format:
> Before I create a plan, I need a few details:
> 1. [question]
> 2. [question]
> 3. [question]

### PHASE 2 — PLAN AND EXECUTE TO COMPLETION (MANDATORY)

Once requirements are clear:

1. Call \`planner_create\` immediately with the full plan.
2. Keep the \`planner_create\` payload simple:
   - \`title\`: a short plan title
   - \`items\`: one string with steps separated by semicolons
   - Example: \`"Inspect logs; patch planner_create; verify the result"\`
3. Make each step short, concrete, and action-oriented.
4. Execute every step in sequence WITHOUT stopping or pausing between steps.
5. After finishing a step, immediately call \`planner_check_item\`, then continue to the next step.
6. If new work appears mid-execution, call \`planner_add_item\` and continue.
7. If a step becomes irrelevant, call \`planner_remove_item\` and continue.
8. Before the final answer, call \`planner_get\`.
9. If any item is still unchecked, keep working until all items are checked.
10. Only deliver the final answer when ALL plan items are checked.

## ABSOLUTE RULES

- NEVER stop in the middle of execution. Complete every step before responding to the user.
- NEVER say "I will do X and then stop" or imply partial delivery. Always finish the full plan.
- NEVER ask follow-up questions one at a time. All questions go in one batch, before planning starts.

## TOOL REFERENCE

- \`planner_create\` — Create the initial plan. Use a short title and a semicolon-separated \`items\` string.
- \`planner_get\` — Read the current plan and completion status.
- \`planner_check_item\` — Mark an item done after completing it.
- \`planner_add_item\` — Add newly discovered work.
- \`planner_remove_item\` — Remove work that is no longer needed.
`;

export const PLANNER_FEATURE_SYSTEM_PROMPT = SYSTEM_PROMPT_INSTRUCTION.trim();

export const PLANNER_FEATURE_TOOLS = [
	"planner_create",
	"planner_get",
	"planner_check_item",
	"planner_add_item",
	"planner_remove_item",
] as const;

export const PLANNER_FEATURE_DESCRIPTION =
	"Forces structured planning with item-by-item completion tracking. Agent must check all items before finishing.";

const definition = defineStep<
	PlannerFeatureInput,
	PlannerFeatureOutput,
	PlannerFeatureServices,
	PlannerFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...PLANNER_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				PLANNER_FEATURE_SYSTEM_PROMPT,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[PLANNER_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Planner feature step failed",
					],
				},
			};
		}
	},
});

type PlannerFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createPlannerFeatureStep: StepFactoryFromSpec<
	PlannerFeatureSpec
> = () => bindStep(definition, undefined, undefined);

stepRegistry.register(STEP_NAME, createPlannerFeatureStep, {
	description: PLANNER_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-planner-feature",
	name: PLANNER_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with planner mode instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with planner toolset.",
		},
	],
	metadata: {
		description: PLANNER_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.plannerFeature.description",
		displayName: "Planner",
		nameKey: "flowBuilder.features.plannerFeature.name",
		tools: [...PLANNER_FEATURE_TOOLS],
		systemPrompt: PLANNER_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "ListChecks", type: "lucide" },
		accentColor: "#14b8a6",
		section: "core",
		sectionOrder: 7,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: PlannerFeatureSpec;
	}
}
