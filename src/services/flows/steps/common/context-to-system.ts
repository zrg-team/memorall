import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { ChatMessage } from "../../interfaces/messages";
import { GraphBase } from "../../graph/graph.base";

const STEP_NAME = "context-to-system" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ContextToSystemInput {
	messages: ChatMessage[];
	context: string;
}

export interface ContextToSystemOutput {
	messages?: ChatMessage[];
}

export type ContextToSystemServices = {};
export type ContextToSystemConfig = {
	prompt?: string;
};

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

export const DEFAULT_CONTEXT_SYSTEM_PROMPT = `
# Context
Available Knowledge Context:
<context>
{context}
</context>

## Context usage buideline
Using the provided knowledge context, provide a comprehensive and accurate answer to the user's query.
If Knowledge Retrieval doesn't contain enough information to fully answer the question, mention what information is available and what might be missing.
Following below order of information:
1. If information to answer is available in Knowledge Retrieval context, use it to answer the question.
2. If information to answer is not available in Knowledge Retrieval context, use your general knowledge to answer the question.
Structure your answer in clear sections when appropriate.
`;

const definition = defineStep<
	ContextToSystemInput,
	ContextToSystemOutput,
	ContextToSystemServices,
	ContextToSystemConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config }) => {
		const contextPrompt = config.prompt?.trim();
		const contextPromptTemplate = contextPrompt
			? contextPrompt.includes("{context}")
				? contextPrompt
				: `${contextPrompt}\n\n{context}`
			: DEFAULT_CONTEXT_SYSTEM_PROMPT;

		const updatedMessages = GraphBase.chat.systemMessage(
			input.messages || [],
			contextPromptTemplate.replace("{context}", input.context || ""),
		);

		return {
			output: {
				messages: updatedMessages,
			},
		};
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

const createStep: StepFactoryFromSpec<Spec> = (
	services: ContextToSystemServices,
	config?: ContextToSystemConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: Spec;
	}
}
