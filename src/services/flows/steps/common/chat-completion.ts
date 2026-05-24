import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type {
	ChatCompletionChunk,
	ChatCompletionResponse,
	ChatMessage,
} from "../../interfaces/messages";

const STEP_NAME = "chat-completion" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ChatCompletionInput {
	messages: ChatMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
}

export interface ChatCompletionOutput {
	response: string;
}

export type ChatCompletionServices = Pick<AllServices, "llm">;
export type ChatCompletionConfig = {
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
};

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	ChatCompletionInput,
	ChatCompletionOutput,
	ChatCompletionServices,
	ChatCompletionConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		const llm = services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		const temperature = input.temperature ?? config?.temperature ?? 0.2;
		const maxTokens = input.maxTokens ?? config?.maxTokens;
		const stream = input.stream ?? config?.stream ?? true;

		const llmResponse = await llm.chatCompletions({
			messages: input.messages,
			temperature,
			max_tokens: maxTokens,
			stream,
		});

		let responseContent = "";
		if (stream && Symbol.asyncIterator in llmResponse) {
			for await (const chunk of llmResponse as AsyncIterableIterator<ChatCompletionChunk>) {
				responseContent += chunk.choices[0].delta.content || "";
				runConfig?.writer?.({ type: "llm", chunk });
			}
		} else {
			const response = llmResponse as ChatCompletionResponse;
			responseContent = response.choices[0].message.content || "";
		}

		return {
			output: {
				response: responseContent,
			},
		};
	},
});

type ChatCompletionSpec = StepSpecFromDefinition<typeof definition>;

export const createChatCompletionStep: StepFactoryFromSpec<
	ChatCompletionSpec
> = (services: ChatCompletionServices, config?: ChatCompletionConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createChatCompletionStep, {
	description: "Single-turn LLM chat completion (no tool-calling loop)",
	configParams: [
		{
			key: "temperature",
			type: "number",
			default: 0.2,
			description: "Sampling temperature",
		},
		{
			key: "stream",
			type: "boolean",
			default: true,
			description: "Stream tokens as they are generated",
		},
	],
	defaultStateMapping: { messages: "messages" },
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ChatCompletionSpec;
	}
}
