import { defineStep, bindStep } from "../../interfaces/engine/step.js";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/engine/step.js";
import { stepRegistry } from "../../registries/step-registry.js";
import type { ChatMessage } from "../../interfaces/engine/messages.js";
import { createOutputMessageChunks } from "../../graph/graph.base.js";

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

/**
 * Default name the retrieval turn is recorded under. It is not a callable tool
 * — nothing declares it and the model never invokes it — it only labels a
 * retrieval that already happened, the same way a real tool result does.
 * Override per flow with `config.retrievalToolName`.
 */
export const KNOWLEDGE_RETRIEVAL_TOOL_NAME = "knowledge_retrieval" as const;

export type ContextToSystemServices = {};
export type ContextToSystemConfig = {
	prompt?: string;
	/**
	 * What the retrieval turn is recorded as. Defaults to
	 * {@link KNOWLEDGE_RETRIEVAL_TOOL_NAME}; a consumer whose retrieval is not
	 * a knowledge graph can name it something its users will recognise.
	 */
	retrievalToolName?: string;
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
	execute: async ({ input, config, runConfig }) => {
		const contextPrompt = config.prompt?.trim();
		const contextPromptTemplate = contextPrompt
			? contextPrompt.includes("{context}")
				? contextPrompt
				: `${contextPrompt}\n\n{context}`
			: DEFAULT_CONTEXT_SYSTEM_PROMPT;

		// Retrieved knowledge is durable context for the turn, so it is appended
		// to the conversation as a retrieval that happened — an assistant turn
		// calling for it and the result coming back — rather than folded into a
		// message that already exists.
		//
		// That distinction is the whole point. Earlier versions appended this to
		// the system prompt (rewriting the first message of every request) and
		// then to the newest user message (rewriting a position the next turn
		// reads through). Appended as its own pair it is written once, persisted
		// as message parts, and replayed byte-identically on every later turn, so
		// the provider serves it from cache instead of re-reading it. A reminder
		// would be re-read at full price on every iteration of the tool loop.
		const content = contextPromptTemplate.replace(
			"{context}",
			input.context || "",
		);
		const toolCallId = `call_${crypto.randomUUID()}`;

		// This shape has to match what `MessagePartsAccumulator` rebuilds from the
		// chunks below, because that is what the next turn replays: an empty
		// string rather than null content, and no `index` on the call.
		const retrieval: ChatMessage[] = [
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: toolCallId,
						type: "function",
						function: {
							name:
								config.retrievalToolName?.trim() ||
								KNOWLEDGE_RETRIEVAL_TOOL_NAME,
							arguments: "{}",
						},
					},
				],
			},
			{ role: "tool", content, tool_call_id: toolCallId },
		];

		// Emitting the pair is what makes it durable: the handler accumulates
		// these chunks into the assistant message's stored parts, and those parts
		// are replayed verbatim into the next request.
		for (const chunk of createOutputMessageChunks(retrieval)) {
			runConfig?.writer?.({ type: "llm", chunk });
		}

		return {
			output: { messages: [...(input.messages ?? []), ...retrieval] },
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
