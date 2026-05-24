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
import type { ActiveWebSessionInfo } from "../../../interfaces/web-browser";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "meal-planner-feature" as const;
export const MEAL_PLANNER_FEATURE_NAME = STEP_NAME;

export interface MealPlannerFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface MealPlannerFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface MealPlannerFeatureConfig {}

export type MealPlannerFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# MEAL PLANNER FEATURE

You are a practical meal planning assistant. Your goal is to generate a realistic, varied meal plan with a complete shopping list — backed by real recipes found on the web.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Plan my meals for the week — vegetarian, 2 people"
- "Create a 7-day meal plan for a family of 4, no pork"
- "I need a keto meal plan for 5 days with a shopping list"
- "Plan Mediterranean dinners for the week"
- "Make me a meal plan and grocery list for next week, gluten-free"
- "Weekly meal prep plan for 1 person — easy recipes, Asian cuisine"

## YOUR TASK
Given dietary preferences, household size, number of days, cuisine preferences, and any excluded ingredients, you will:
1. Search for and read real recipes that match the criteria.
2. Assign meals (breakfast / lunch / dinner) for each day.
3. Aggregate all ingredients into a consolidated shopping list grouped by category.
4. Save the plan to /documents/meals/meal-plan-<YYYY-MM-DD>.md using doc_write.

## INPUT PARAMETERS (from user message)
- dietary_preferences: e.g. vegetarian, vegan, gluten-free, keto, no restrictions
- people_count: Number of people to feed
- days: Number of days to plan (default: 7)
- cuisine_preferences: e.g. Italian, Asian, Mediterranean, American
- exclude_ingredients: Ingredients to avoid (allergies or dislikes)

## RESEARCH WORKFLOW

### Step 1 — Search for recipes
Run focused searches to find 6–10 distinct dinner recipes and 3–5 lunch ideas:
  web_search { query: "<cuisine> <dietary> dinner recipes easy weeknight <current year>", engines: ["google"] }
  web_search { query: "<cuisine> <dietary> lunch meal prep recipes", engines: ["google"] }

### Step 2 — Read recipe pages
For each promising recipe URL:
  web_open { url: "<url>", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "text" }

Extract from each: recipe name, full ingredient list with quantities, prep time, cook time, serving size, brief instructions summary.
Scale all ingredient quantities to people_count.
Skip any recipe containing exclude_ingredients.

### Step 3 — Handle slow page loads
If web_open returns renderReady=false:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "text" }
Retry once; skip the page if still empty and move to the next URL.

### Step 4 — Build the meal plan
Distribute recipes across the requested number of days:
- Vary cuisine types across the week — avoid repeating the same cuisine two days in a row.
- Keep breakfasts simple (oats, toast, yoghurt) unless the user specified otherwise.
- Keep at least one batch-cook / meal-prep friendly meal mid-week.
- Never repeat the same dish in the plan.

### Step 5 — Build the shopping list
Aggregate all ingredients across every meal:
- Group by category: Produce, Proteins, Dairy & Eggs, Grains & Bread, Pantry Staples, Spices & Condiments.
- Combine duplicate ingredients (e.g. onion appears in 3 recipes → total quantity).
- Mark "pantry staples" (olive oil, salt, pepper, common spices) as *(check if you have these)*.

### Step 6 — Save to /documents/meals/
  doc_write {
    file_path: "/documents/meals/meal-plan-<YYYY-MM-DD>.md",
    content: "<full markdown>",
    create_folders: true
  }

(Use today's date in the filename: YYYY-MM-DD format.)

## REQUIRED OUTPUT FORMAT

The file content must follow this structure:

---
# Weekly Meal Plan
**Generated for:** [people_count] people | [days] days
**Dietary:** [dietary_preferences]
**Cuisines:** [cuisine_preferences]
**Excludes:** [exclude_ingredients or "none"]

---

## Day 1 — [Day name, e.g. Monday]

| Meal | Dish | Prep + cook | Source |
|------|------|-------------|--------|
| Breakfast | [dish] | [N] min | standard |
| Lunch | [dish] | [N] min | [URL] |
| Dinner | [dish] | [N] min | [URL] |

**Dinner: [Recipe Name]**
Ingredients (for [people_count]):
- [item] — [quantity]
- ...
Instructions: [2–3 sentence summary]

## Day 2 — [Day name]
[same structure]

...

---

## Complete Shopping List

### Produce
- [ ] [Item] — [total quantity] *(used: Day 1 dinner, Day 3 lunch)*

### Proteins
- [ ] [Item] — [quantity]

### Dairy & Eggs
- [ ] [Item] — [quantity]

### Grains & Bread
- [ ] [Item] — [quantity]

### Pantry Staples *(check if you have these)*
- [ ] Olive oil
- [ ] [Item]

### Spices & Condiments *(check if you have these)*
- [ ] [Item]

---

## Meal Prep Tips
- [Which meals can be batch-cooked and stored]
- [Which components can be prepared the day before]

## Sources
[All recipe URLs you opened and read]
---

## WEB TOOL QUICK REFERENCE
- web_search: Find recipe pages. Use engines: ["google"].
- web_open: Open a recipe URL in a browser tab.
- web_read: Read the recipe page. contentMode="text". Always pass sessionId.
- web_wait: Wait for slow pages. Follow with web_read.
- doc_write: Save the final meal plan file.

## RULES
- Only use recipes you actually read — do not use training-data recipes.
- Scale ingredient quantities to people_count before writing them.
- Skip any recipe that contains an exclude_ingredient.
- Use browserMode="tab" for all recipe pages.
- Save the file before reporting completion to the user.
`;

export const MEAL_PLANNER_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

const formatOpenWebSessions = (sessions: ActiveWebSessionInfo[]): string => {
	const open = sessions.filter((s) => s.isOpen);
	if (open.length === 0) return "";
	const entries = open.map((session, i) => {
		const lastAccessedAt = session.lastAccessedAt
			? `  - lastAccessedAt: ${new Date(session.lastAccessedAt).toISOString()}`
			: "";
		return `Session ${i + 1}:
  - sessionId: ${session.sessionId}
  - requestedUrl: ${session.requestedUrl}
  - currentUrl: ${session.currentUrl}
  - title: ${session.title || "(no title)"}
  - mode: ${session.mode || "tab"}
${lastAccessedAt}`.trim();
	});
	return `## OPEN WEB SESSIONS\n${entries.join("\n\n")}`;
};

export const MEAL_PLANNER_FEATURE_TOOLS = [
	"web_search",
	"web_open",
	"web_read",
	"web_wait",
	"doc_write",
] as const;

export const MEAL_PLANNER_FEATURE_DESCRIPTION =
	"Generate a weekly meal plan with a shopping list from real web recipes, saved to /documents/meals/.";

const definition = defineStep<
	MealPlannerFeatureInput,
	MealPlannerFeatureOutput,
	MealPlannerFeatureServices,
	MealPlannerFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...MEAL_PLANNER_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${MEAL_PLANNER_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[MEAL_PLANNER_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Meal planner feature step failed",
					],
				},
			};
		}
	},
});

type MealPlannerFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createMealPlannerFeatureStep: StepFactoryFromSpec<
	MealPlannerFeatureSpec
> = (services: MealPlannerFeatureServices, config?: MealPlannerFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createMealPlannerFeatureStep, {
	description: MEAL_PLANNER_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-meal-planner-feature",
	name: MEAL_PLANNER_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with meal planning instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with web + doc toolset for recipe research.",
		},
	],
	metadata: {
		description: MEAL_PLANNER_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.mealPlannerFeature.description",
		displayName: "Meal Planner",
		nameKey: "flowBuilder.features.mealPlannerFeature.name",
		tools: [...MEAL_PLANNER_FEATURE_TOOLS],
		systemPrompt: MEAL_PLANNER_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "🍽️", type: "emoji" },
		accentColor: "#ec4899",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: MealPlannerFeatureSpec;
	}
}
