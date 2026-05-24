import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { ChatMessage } from "../../interfaces/messages";
import { GraphBase } from "../../graph/graph.base";

export const ADD_SYSTEM_STEP_NAME = "add-system" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

interface Input {
	messages: ChatMessage[];
	/**
	 * Optional inline content — takes precedence over config.content.
	 * Prefer putting the prompt in config so it persists in the flow config;
	 * use input only when the content must be computed at runtime.
	 */
	content?: string;
}

interface Output {
	messages?: ChatMessage[];
}

type Services = Record<string, never>;

export interface AddSystemConfig {
	/**
	 * System prompt content to prepend.
	 * Set via StepInstanceConfig.config.content in the flow config.
	 */
	content?: string;
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<Input, Output, Services, AddSystemConfig>({
	name: ADD_SYSTEM_STEP_NAME,
	execute: async ({ input, config }) => {
		// input.content takes precedence; config.content is the persisted default.
		const content = input.content ?? config?.content;

		if (!content?.trim()) {
			return { output: {} };
		}

		const updatedMessages = GraphBase.chat.systemMessage(
			input.messages ?? [],
			content,
		);

		return { output: { messages: updatedMessages } };
	},
});

type Spec = StepSpecFromDefinition<typeof definition>;

const createStep: StepFactoryFromSpec<Spec> = (
	services: Services,
	config?: AddSystemConfig,
) => bindStep(definition, services, config);

stepRegistry.register(ADD_SYSTEM_STEP_NAME, createStep, {
	description: "Prepend a system message to the conversation",
	configParams: [
		{
			key: "content",
			type: "string",
			default: "",
			description: "System prompt text to prepend",
		},
	],
	defaultStateMapping: { messages: "messages" },
	enabledByDefault: true,
});

declare global {
	interface StepTypeRegistry {
		[ADD_SYSTEM_STEP_NAME]: Spec;
	}
}
