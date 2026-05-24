import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import {
	featureCatalogRegistry,
	type FeatureCatalogMetadata,
} from "../../feature-catalog-registry";
import type { ChatMessage } from "../../interfaces/messages";
import type { AllServices } from "../../interfaces/tool";
import { GraphBase } from "../../graph/graph.base";

export const GPT_BOOST_STEP_NAME = "gpt-boost" as const;

const GPT_BOOST_SYSTEM_PROMPT = `I will identify the correct storage/tool for each action. If ambiguous, I'll state my reasoning and assumptions.
I'll execute tools immediately after announcing them. On failure, I'll report the error, attempt recovery, and explain my process.
I won't ask for clarification. If context is insufficient, I'll proceed with reasonable assumptions and state my basis.
I'll break tasks into explicit steps with visible reasoning and verification. When verification isn't possible, I'll state this.
I'll continue until complete with concrete results. I won't fabricate missing references.`;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

interface Input {
	messages: ChatMessage[];
}

interface Output {
	messages?: ChatMessage[];
}

type Services = Pick<AllServices, "llm">;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

function isGptModel(modelId: string): boolean {
	return /gpt-/i.test(modelId);
}

const definition = defineStep<Input, Output, Services>({
	name: GPT_BOOST_STEP_NAME,
	execute: async ({ input, services }) => {
		const modelInfo = await services.llm.getCurrentModel();

		if (!modelInfo?.modelId || !isGptModel(modelInfo.modelId)) {
			return { output: {} };
		}

		const updatedMessages = GraphBase.chat.systemMessage(
			input.messages ?? [],
			GPT_BOOST_SYSTEM_PROMPT,
		);

		return { output: { messages: updatedMessages } };
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

export const createGptBoostStep: StepFactoryFromSpec<Spec> = (
	services: Services,
) => bindStep(definition, services);

const GPT_BOOST_DESCRIPTION =
	"Injects a structured-reasoning system prompt when the current model is GPT (gpt-4.1 / gpt-5)";

stepRegistry.register(GPT_BOOST_STEP_NAME, createGptBoostStep, {
	description: GPT_BOOST_DESCRIPTION,
	configParams: [],
	defaultStateMapping: { messages: "messages" },
	enabledByDefault: true,
});

featureCatalogRegistry.register({
	id: "step-gpt-boost",
	name: GPT_BOOST_STEP_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: [
		{
			name: "messages",
			type: "Message[]",
			required: true,
			description: "Current chat messages",
		},
	],
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with GPT structured-reasoning instructions prepended.",
		},
	],
	metadata: {
		description: GPT_BOOST_DESCRIPTION,
		displayName: "GPT Boost",
		tools: [],
		systemPrompt: GPT_BOOST_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Zap", type: "lucide" },
		accentColor: "#10b981",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[GPT_BOOST_STEP_NAME]: Spec;
	}
}
