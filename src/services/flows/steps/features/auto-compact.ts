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
	FEATURE_DEFAULT_OUTPUTS,
	type FeatureCatalogMetadata,
} from "../../feature-catalog-registry";
import type { ChatCompletionMessageParam } from "../../interfaces/messages";
import type { ChatCompletionResponse } from "../../interfaces/messages";
import type { BaseLLM } from "../../interfaces/llm";
import type { BaseStateBase } from "../../graph/graph.base";
import { estimatePromptTokens } from "../../utils/token-usage";

const STEP_NAME = "auto-compact" as const;
const COMPACT_THRESHOLD_RATIO = 0.75;
// Number of complete tool-call flows to keep verbatim in outputMessages
const KEEP_RECENT_FLOWS = 2;

function extractText(m: ChatCompletionMessageParam): string {
	const content =
		typeof m.content === "string"
			? m.content
			: Array.isArray(m.content)
				? m.content
						.map((p) => ("text" in p ? (p as { text: string }).text : ""))
						.join("")
				: "";
	if (
		m.role === "assistant" &&
		"tool_calls" in m &&
		Array.isArray(m.tool_calls) &&
		m.tool_calls.length > 0
	) {
		const names = m.tool_calls.map((tc) => tc.function.name).join(", ");
		return content ? `${content} [calls: ${names}]` : `[calls: ${names}]`;
	}
	return content;
}

function buildSummarizationPrompt(
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
	const formatted = messages
		.map(
			(m) =>
				`[${m.role === "tool" ? "tool-result" : m.role}]: ${extractText(m)}`,
		)
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

async function summarize(
	messages: ChatCompletionMessageParam[],
	llm: BaseLLM,
): Promise<string> {
	const response = (await llm.chatCompletions({
		messages: buildSummarizationPrompt(messages),
		stream: false,
	})) as ChatCompletionResponse;
	return response.choices[0]?.message?.content ?? "";
}

// Groups outputMessages into complete tool-call flows.
// Each flow starts at an assistant message and includes all subsequent tool
// result messages up to (but not including) the next assistant message.
function groupIntoFlows(
	messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[][] {
	const flows: ChatCompletionMessageParam[][] = [];
	let current: ChatCompletionMessageParam[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant" && current.length > 0) {
			flows.push(current);
			current = [];
		}
		current.push(msg);
	}
	if (current.length > 0) flows.push(current);
	return flows;
}

// Compacts conversation history: keeps system messages + last user message (goal),
// summarizes everything in between into a single assistant message.
async function compactHistory(
	messages: ChatCompletionMessageParam[],
	llm: BaseLLM,
): Promise<ChatCompletionMessageParam[]> {
	const systemMessages = messages.filter((m) => m.role === "system");
	const nonSystem = messages.filter((m) => m.role !== "system");

	let lastUserIdx = -1;
	for (let i = nonSystem.length - 1; i >= 0; i--) {
		if (nonSystem[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}

	if (lastUserIdx <= 0) return messages;

	const toSummarize = nonSystem.slice(0, lastUserIdx);
	const lastUserMessage = nonSystem[lastUserIdx];

	try {
		const summary = await summarize(toSummarize, llm);
		return [
			...systemMessages,
			{
				role: "assistant",
				content: `[Conversation history summary]\n${summary}`,
			},
			lastUserMessage,
		];
	} catch (error) {
		logError(
			"[AUTO_COMPACT] History compaction failed, keeping original:",
			error,
		);
		return messages;
	}
}

// Compacts tool-call flows in outputMessages: groups messages into complete
// assistant+tool flows, keeps the most recent KEEP_RECENT_FLOWS flows verbatim,
// and summarizes the older ones into a single assistant message.
async function compactOutputMessages(
	outputMessages: ChatCompletionMessageParam[],
	llm: BaseLLM,
): Promise<ChatCompletionMessageParam[]> {
	const flows = groupIntoFlows(outputMessages);
	if (flows.length <= KEEP_RECENT_FLOWS) return outputMessages;

	const toSummarize = flows.slice(0, -KEEP_RECENT_FLOWS).flat();
	const toKeep = flows.slice(-KEEP_RECENT_FLOWS).flat();

	try {
		const summary = await summarize(toSummarize, llm);
		return [
			{ role: "assistant", content: `[Earlier steps summary]\n${summary}` },
			...toKeep,
		];
	} catch (error) {
		logError(
			"[AUTO_COMPACT] Output compaction failed, keeping original:",
			error,
		);
		return outputMessages;
	}
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

					const [compactedMessages, compactedOutput] = await Promise.all([
						compactHistory(agentState.messages, services.llm),
						compactOutputMessages(agentState.outputMessages, services.llm),
					]);
					return {
						messages: compactedMessages,
						outputMessages: compactedOutput,
					};
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

featureCatalogRegistry.register({
	id: "step-auto-compact",
	name: STEP_NAME,
	type: "feature",
	graphTypes: ["foundation", "agent"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: FEATURE_DEFAULT_OUTPUTS,
	metadata: {
		description:
			"Automatically compact agent working memory when context budget is exceeded",
		descriptionKey: "flowBuilder.features.autoCompact.description",
		displayName: "Auto Compact",
		nameKey: "flowBuilder.features.autoCompact.name",
		tools: [],
		systemPrompt: "",
		customizable: false,
		icon: { name: "Minimize2", type: "lucide" },
		accentColor: "#6366f1",
		section: "core",
		sectionOrder: 9,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: AutoCompactSpec;
	}
}
