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
import { ACTIVE_MEMORY_TOOLS } from "../../tools/active-memory";
import { getFlowRuntimeVars } from "../../runtime/runtime-context";

const STEP_NAME = "active-memory-feature" as const;
export const ACTIVE_MEMORY_FEATURE_NAME = STEP_NAME;

export interface ActiveMemoryFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
	graphId?: string;
}

export interface ActiveMemoryFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface ActiveMemoryFeatureConfig {}

type ActiveMemoryFeatureServices = Record<string, never>;

const SYSTEM_PROMPT_INSTRUCTION = `
# ACTIVE MEMORY
You can manage durable memory in the currently selected topic/graph through typed memory tools.

Use active memory only for information the user clearly wants preserved, such as:
- stable preferences
- project context
- durable facts about the user's work
- explicit corrections to previous memory

Do not store sensitive personal data, secrets, credentials, payment details, tokens, or speculative facts.

The memory tools automatically use the current selected topic/graph. Do not ask the user for a graph id.

## Tools
- \`memory_remember\`: save a new fact, preference, or project-context item
- \`memory_retrieve\`: search saved memories
- \`memory_update\`: replace an existing memory while preserving history
- \`memory_remove\`: forget a memory by marking it inactive
- \`memory_explain_source\`: explain where a memory came from

When updating or removing memory, first retrieve likely matching memories unless the user already provided a memory id.
`;

export const ACTIVE_MEMORY_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();
export const ACTIVE_MEMORY_FEATURE_DESCRIPTION =
	"Enable typed active-memory tools for remembering, retrieving, updating, removing, and explaining durable memories in the current topic graph.";

const definition = defineStep<
	ActiveMemoryFeatureInput,
	ActiveMemoryFeatureOutput,
	ActiveMemoryFeatureServices,
	ActiveMemoryFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, runConfig }) => {
		try {
			const graphId = input.graphId?.trim();
			if (!graphId) {
				return {
					output: {
						tools: input.tools,
						messages: input.messages,
					},
				};
			}

			const runtimeVars = getFlowRuntimeVars(runConfig);
			runtimeVars?.set("memory.graph.id", graphId);

			const tools = GraphBase.chat.addTool(input.tools, ...ACTIVE_MEMORY_TOOLS);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				ACTIVE_MEMORY_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[ACTIVE_MEMORY_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Active memory feature step failed",
					],
				},
			};
		}
	},
});

type ActiveMemoryFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createActiveMemoryFeatureStep: StepFactoryFromSpec<
	ActiveMemoryFeatureSpec
> = (
	services: ActiveMemoryFeatureServices,
	config?: ActiveMemoryFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createActiveMemoryFeatureStep, {
	description: ACTIVE_MEMORY_FEATURE_DESCRIPTION,
	defaultStateMapping: {
		messages: "messages",
		tools: "tools",
		graphId: "graphId",
	},
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-active-memory-feature",
	name: ACTIVE_MEMORY_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation", "agent"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with active-memory instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with active-memory operations.",
		},
	],
	metadata: {
		description: ACTIVE_MEMORY_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.activeMemoryFeature.description",
		displayName: "Active Memory",
		nameKey: "flowBuilder.features.activeMemoryFeature.name",
		tools: [...ACTIVE_MEMORY_TOOLS],
		systemPrompt: ACTIVE_MEMORY_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Brain", type: "lucide" },
		accentColor: "#14b8a6",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ActiveMemoryFeatureSpec;
	}
}
