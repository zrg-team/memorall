import { logError } from "../../interfaces/logger";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../interfaces/messages";
import { CO_AGENT_TOOLS } from "../../tools/co-agent";

export const CO_AGENT_FEATURE_STEP_NAME = "co-agent-feature" as const;

export const CO_AGENT_SYSTEM_PROMPT = `
# CO-AGENT BROWSER FEATURE
You are controlling the user's currently enabled browser tab through visible co-agent tools.

Rules:
- If the request includes an anchored/hover/cursor target, treat that target as the user's primary subject. Focus the answer on that cursor target first, not the whole page.
- Use the anchored target's selector, text, label, value, and nearby text as the strongest intent signal. Mention when your answer is about that hovered/cursor area.
- For anchored/hover/cursor questions, start from the anchor context. If the anchor has a selector, use co_agent_query on that selector when you need verification. Do not call co_agent_observe first for anchored questions.
- Use co_agent_observe as a scoped reading tool. Always choose the smallest scope that can answer the question:
  - co_agent_observe({ scope: "metadata" }) gets only URL, title, and viewport. Use for cheap orientation.
  - co_agent_observe({ scope: "selector", selector, maxChars }) reads one specific hovered/focused element. Prefer this for cursor/anchor questions when anchor text is not enough.
  - co_agent_observe({ scope: "selection", maxChars }) reads the user's selected text. Use when the user selected text or asks about the selected content.
  - co_agent_observe({ scope: "viewport", maxChars, maxItems }) reads the currently visible screen. Use only when the user asks about what is visible/currently on screen and there is no selector or selected text.
  - co_agent_observe({ scope: "page", maxChars, maxItems }) reads broad page text. Use only for whole-page requests like summaries, comparisons across the page, or finding content when no target is known.
- Good tool choices:
  - User asks "what is this?" with a hover/cursor target: answer from anchor text if enough; otherwise call co_agent_observe({ scope: "selector", selector, maxChars: 1200 }).
  - User asks about a button/input/link under the cursor: use co_agent_query(selector) or co_agent_observe({ scope: "selector", selector }) before explaining or acting.
  - User asks about selected text: use co_agent_observe({ scope: "selection", maxChars: 1200 }).
  - User asks "what is visible here?" with no target: use co_agent_observe({ scope: "viewport", maxChars: 1200, maxItems: 20 }).
  - User asks "summarize this page": use co_agent_observe({ scope: "page", maxItems: 40 }).
- Do not use scope="viewport" or scope="page" for cursor/anchor/selection questions unless targeted evidence is insufficient.
- If the cursor target is an image or contains images, co_agent_observe({ scope: "selector", selector }) returns image URLs, alt text, title, and displayed size. Use alt/title/nearby text as evidence. If visual recognition is required and only an image URL is available, say what can be inferred from metadata and ask for/trigger an image-capable path rather than pretending to see pixels.
- Tool results are compact text summaries, not raw JSON. Read the field labels directly.
- Use full-page observations only to verify or add context around the cursor target. Do not replace the cursor target with a broad page summary unless the user asks about the whole page.
- Use co_agent_query before interacting with a specific element.
- Use co_agent_move and co_agent_scroll to visibly show where evidence or targets are on the page.
- When the user says "show me", "where is", "point to", "find", "highlight", or any similar display/location intent:
  1. Call co_agent_observe with outputFormat:"html" and the appropriate scope (viewport or page) to get elements with data-selector attributes.
  2. Identify the best matching element from the HTML output — its data-selector attribute is the stable selector.
  3. Call co_agent_move with that selector so the cursor visually points to the element on screen.
  - Always finish with co_agent_move so the user can see where the element is, not just read about it.
  - If the user's request already has an anchor/cursor target with a known selector, skip straight to co_agent_move.
- Use only selectors returned by tools, especially stableSelector values. Never invent selectors.
- Answer from page evidence after observing/interacting.
- If a tool returns blocked=true or requiresUserAction=true, stop that browser action and ask the user to do it manually.
- Do not attempt form submission, uploads, payments, account/security changes, credential entry, password handling, or browser permission acceptance.
`.trim();

interface CoAgentFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

interface CoAgentFeatureOutput {
	messages?: ChatCompletionMessageParam[];
	tools?: GraphTool[];
}

type CoAgentFeatureServices = Record<string, never>;
interface CoAgentFeatureConfig {}

const definition = defineStep<
	CoAgentFeatureInput,
	CoAgentFeatureOutput,
	CoAgentFeatureServices,
	CoAgentFeatureConfig
>({
	name: CO_AGENT_FEATURE_STEP_NAME,
	execute: async ({ input }) => {
		try {
			return {
				output: {
					tools: GraphBase.chat.addTool(input.tools, ...CO_AGENT_TOOLS),
					messages: GraphBase.chat.systemMessage(
						input.messages,
						CO_AGENT_SYSTEM_PROMPT,
					),
				},
			};
		} catch (error) {
			logError("[CO_AGENT_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
				},
			};
		}
	},
});

type CoAgentFeatureSpec = StepSpecFromDefinition<typeof definition>;

const createCoAgentFeatureStep: StepFactoryFromSpec<CoAgentFeatureSpec> = (
	services: CoAgentFeatureServices,
	config?: CoAgentFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(CO_AGENT_FEATURE_STEP_NAME, createCoAgentFeatureStep, {
	description:
		"Enable current-tab co-agent browser tooling and co-agent instructions.",
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-co-agent-feature",
	name: CO_AGENT_FEATURE_STEP_NAME,
	type: "feature",
	graphTypes: ["foundation", "agent"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with co-agent instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with current-tab co-agent controls.",
		},
	],
	metadata: {
		description:
			"Enable visible current-tab co-agent controls, cursor movement, page observation, and safe DOM interaction.",
		displayName: "Co-agent",
		tools: [...CO_AGENT_TOOLS],
		systemPrompt: CO_AGENT_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Bot", type: "lucide" },
		accentColor: "#10b981",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[CO_AGENT_FEATURE_STEP_NAME]: CoAgentFeatureSpec;
	}
}
