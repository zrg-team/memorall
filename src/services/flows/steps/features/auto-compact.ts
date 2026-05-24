import { logError } from "../../interfaces/logger";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { ChatCompletionMessageParam } from "../../interfaces/messages";
import type { ChatCompletionResponse } from "../../interfaces/messages";
import type { BaseLLM } from "../../interfaces/llm";
import type { BaseStateBase } from "../../graph/graph.base";
import { estimatePromptTokens } from "../../utils/token-usage";

const STEP_NAME = "auto-compact" as const;
const COMPACT_THRESHOLD_RATIO = 0.75;
const KEEP_RECENT_COUNT = 4;

function buildSummarizationPrompt(
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
	const formatted = messages
		.map((m) => {
			const content =
				typeof m.content === "string"
					? m.content
					: Array.isArray(m.content)
						? m.content
								.map((p) => ("text" in p ? (p as { text: string }).text : ""))
								.join("")
						: "";
			return `[${m.role}]: ${content}`;
		})
		.join("\n\n");

	return [
		{
			role: "system",
			content:
				"You are a summarization assistant. Summarize the following agent steps concisely, preserving key facts, tool results, and decisions made. Be brief.",
		},
		{
			role: "user",
			content: `Summarize these steps:\n\n${formatted}`,
		},
	];
}

async function compactOutputMessages(
	outputMessages: ChatCompletionMessageParam[],
	llm: BaseLLM,
): Promise<ChatCompletionMessageParam[]> {
	if (outputMessages.length <= KEEP_RECENT_COUNT) return outputMessages;

	const toSummarize = outputMessages.slice(0, -KEEP_RECENT_COUNT);
	const toKeep = outputMessages.slice(-KEEP_RECENT_COUNT);

	const response = (await llm.chatCompletions({
		messages: buildSummarizationPrompt(toSummarize),
		stream: false,
	})) as ChatCompletionResponse;

	const summary = response.choices[0]?.message?.content ?? "";

	return [
		{
			role: "system",
			content: `[Earlier steps summary]\n${summary}`,
		},
		...toKeep,
	];
}

export interface AutoCompactInput {
	messages: ChatCompletionMessageParam[];
	outputMessages: ChatCompletionMessageParam[];
}

export interface AutoCompactOutput {}

export interface AutoCompactServices {
	llm: BaseLLM;
}

export interface AutoCompactConfig {}

const definition = defineStep<
	AutoCompactInput,
	AutoCompactOutput,
	AutoCompactServices,
	AutoCompactConfig
>({
	name: STEP_NAME,
	execute: async ({ services, runLifecycle }) => {
		try {
			runLifecycle?.onBeforeStart(
				"auto-compact",
				"agent",
				async (state: Record<string, unknown>) => {
					const agentState = state as unknown as BaseStateBase;
					const allMessages = [
						...agentState.messages,
						...agentState.outputMessages,
					];
					const maxTokens = await services.llm.getMaxModelTokens();

					if (
						estimatePromptTokens(allMessages) <=
						maxTokens * COMPACT_THRESHOLD_RATIO
					)
						return;

					const compacted = await compactOutputMessages(
						agentState.outputMessages,
						services.llm,
					);
					return { outputMessages: compacted };
				},
			);
		} catch (error) {
			logError("[AUTO_COMPACT] Failed to register lifecycle hook:", error);
		}

		return { output: {} };
	},
});

type AutoCompactSpec = StepSpecFromDefinition<typeof definition>;

export const createAutoCompactStep: StepFactoryFromSpec<AutoCompactSpec> = (
	services: AutoCompactServices,
	config?: AutoCompactConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createAutoCompactStep, {
	description:
		"Automatically compact agent working memory when context budget is exceeded",
	defaultStateMapping: {
		messages: "messages",
		outputMessages: "outputMessages",
	},
	enabledByDefault: true,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: AutoCompactSpec;
	}
}
