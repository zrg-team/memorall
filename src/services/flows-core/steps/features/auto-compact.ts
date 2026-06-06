import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { logError } from "flow-core/utils/logger";
import { stepRegistry } from "flow-core/registries/step-registry";
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";
import type { ChatCompletionResponse } from "flow-core/interfaces/engine/messages";
import type { BaseLLM } from "flow-core/interfaces/services/llm";
import type { BaseStateBase } from "flow-core/graph/graph.base";
import { estimatePromptTokens } from "flow-core/utils/token-usage";

const STEP_NAME = "auto-compact" as const;
const DEFAULT_COMPACT_THRESHOLD_RATIO = 0.75;
const DEFAULT_SAFE_THRESHOLD_RATIO = 0.65;
const TRIMMED_TOOL_RESULT_CONTENT =
	"[Tool result trimmed to reduce context. The assistant tool call is preserved.]";
// Number of complete tool-call flows to keep verbatim in outputMessages
const KEEP_RECENT_FLOWS = 2;

type AutoCompactState = Pick<BaseStateBase, "messages" | "outputMessages">;

type ResolvedAutoCompactConfig = {
	compactThresholdRatio: number;
	safeThresholdRatio: number;
};

const clampRatio = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(0.95, Math.max(0.05, value));
};

function resolveAutoCompactConfig(
	config?: AutoCompactConfig,
): ResolvedAutoCompactConfig {
	const compactThresholdRatio = clampRatio(
		config?.compactThresholdRatio,
		DEFAULT_COMPACT_THRESHOLD_RATIO,
	);
	const safeThresholdRatio = Math.min(
		clampRatio(config?.safeThresholdRatio, DEFAULT_SAFE_THRESHOLD_RATIO),
		compactThresholdRatio,
	);
	return { compactThresholdRatio, safeThresholdRatio };
}

function estimateStateTokens(state: AutoCompactState): number {
	return estimatePromptTokens([...state.messages, ...state.outputMessages]);
}

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

const hasToolCalls = (message: ChatCompletionMessageParam): boolean =>
	message.role === "assistant" && !!message.tool_calls?.length;

function trimOldestToolResult(
	state: AutoCompactState,
): AutoCompactState | undefined {
	for (const key of ["messages", "outputMessages"] as const) {
		const index = state[key].findIndex(
			(message) =>
				message.role === "tool" &&
				extractText(message).trim() !== TRIMMED_TOOL_RESULT_CONTENT,
		);
		if (index === -1) continue;

		return {
			...state,
			[key]: state[key].map((message, messageIndex) =>
				messageIndex === index && message.role === "tool"
					? {
							...message,
							content: TRIMMED_TOOL_RESULT_CONTENT,
						}
					: message,
			),
		};
	}

	return undefined;
}

function removeOldestToolCallFlow(
	state: AutoCompactState,
): AutoCompactState | undefined {
	for (const key of ["messages", "outputMessages"] as const) {
		const index = state[key].findIndex(hasToolCalls);
		if (index === -1) continue;

		const assistantMessage = state[key][index];
		if (
			assistantMessage.role !== "assistant" ||
			!assistantMessage.tool_calls?.length
		) {
			continue;
		}

		const toolCallIds = new Set(
			assistantMessage.tool_calls.map((toolCall) => toolCall.id),
		);
		return {
			messages: state.messages.filter(
				(message, messageIndex) =>
					!(
						key === "messages" &&
						messageIndex === index &&
						message.role === "assistant"
					) &&
					!(message.role === "tool" && toolCallIds.has(message.tool_call_id)),
			),
			outputMessages: state.outputMessages.filter(
				(message, messageIndex) =>
					!(
						key === "outputMessages" &&
						messageIndex === index &&
						message.role === "assistant"
					) &&
					!(message.role === "tool" && toolCallIds.has(message.tool_call_id)),
			),
		};
	}

	return undefined;
}

function getLatestUserRef(
	state: AutoCompactState,
): { key: keyof AutoCompactState; index: number } | undefined {
	for (const key of ["outputMessages", "messages"] as const) {
		for (let index = state[key].length - 1; index >= 0; index--) {
			if (state[key][index].role === "user") {
				return { key, index };
			}
		}
	}
	return undefined;
}

function trimOldestChatMessage(
	state: AutoCompactState,
): AutoCompactState | undefined {
	const latestUserRef = getLatestUserRef(state);

	for (const key of ["messages", "outputMessages"] as const) {
		const index = state[key].findIndex((message, messageIndex) => {
			if (message.role === "user") {
				return !(
					latestUserRef?.key === key && latestUserRef.index === messageIndex
				);
			}
			return message.role === "assistant" && !message.tool_calls?.length;
		});
		if (index === -1) continue;

		return {
			...state,
			[key]: state[key].filter((_, messageIndex) => messageIndex !== index),
		};
	}

	return undefined;
}

function trimToSafeThreshold(
	state: AutoCompactState,
	safeTokenThreshold: number,
): AutoCompactState {
	let nextState = state;
	const trimmers = [
		trimOldestToolResult,
		removeOldestToolCallFlow,
		trimOldestChatMessage,
	];
	let iterations = 0;

	for (const trim of trimmers) {
		while (estimateStateTokens(nextState) > safeTokenThreshold) {
			const trimmedState = trim(nextState);
			if (!trimmedState) break;
			nextState = trimmedState;
			iterations++;
			if (iterations > 10000) return nextState;
		}
	}

	return nextState;
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

export async function applyAutoCompactPolicy(
	state: AutoCompactState,
	llm: BaseLLM,
	config: AutoCompactConfig | undefined,
	maxTokens: number,
): Promise<AutoCompactState | undefined> {
	if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
		return undefined;
	}

	const resolvedConfig = resolveAutoCompactConfig(config);
	const compactTokenThreshold =
		maxTokens * resolvedConfig.compactThresholdRatio;
	const safeTokenThreshold = maxTokens * resolvedConfig.safeThresholdRatio;

	if (estimateStateTokens(state) <= compactTokenThreshold) {
		return undefined;
	}

	let compactedState = trimToSafeThreshold(state, safeTokenThreshold);
	if (estimateStateTokens(compactedState) <= safeTokenThreshold) {
		return compactedState;
	}

	const [compactedMessages, compactedOutput] = await Promise.all([
		compactHistory(compactedState.messages, llm),
		compactOutputMessages(compactedState.outputMessages, llm),
	]);

	compactedState = trimToSafeThreshold(
		{
			messages: compactedMessages,
			outputMessages: compactedOutput,
		},
		safeTokenThreshold,
	);

	return compactedState;
}

export interface AutoCompactInput {
	messages: ChatCompletionMessageParam[];
	outputMessages: ChatCompletionMessageParam[];
}

export interface AutoCompactOutput {}

export interface AutoCompactServices {
	llm: BaseLLM;
}

export interface AutoCompactConfig {
	compactThresholdRatio?: number;
	safeThresholdRatio?: number;
}

const definition = defineStep<
	AutoCompactInput,
	AutoCompactOutput,
	AutoCompactServices,
	AutoCompactConfig
>({
	name: STEP_NAME,
	execute: async ({ services, config, runLifecycle }) => {
		try {
			runLifecycle?.onBeforeStart(
				"auto-compact",
				"agent",
				async (state: Record<string, unknown>) => {
					const agentState = state as unknown as BaseStateBase;
					const maxTokens = await services.llm.getMaxModelTokens();
					return await applyAutoCompactPolicy(
						{
							messages: agentState.messages,
							outputMessages: agentState.outputMessages,
						},
						services.llm,
						config,
						maxTokens,
					);
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
	configParams: [
		{
			key: "compactThresholdRatio",
			type: "number",
			default: DEFAULT_COMPACT_THRESHOLD_RATIO,
			description:
				"Prompt-token budget ratio that triggers automatic compaction.",
		},
		{
			key: "safeThresholdRatio",
			type: "number",
			default: DEFAULT_SAFE_THRESHOLD_RATIO,
			description:
				"Prompt-token budget ratio that compaction tries to reduce history below.",
		},
	],
	defaultStateMapping: {
		messages: "messages",
		outputMessages: "outputMessages",
	},
	enabledByDefault: true,
	feature: {
		id: "step-auto-compact",
		type: "feature",
		graphTypes: ["foundation", "agent"],
		inputs: [
			{
				name: "messages",
				type: "Message[]",
				required: true,
				description: "Current chat messages",
			},
			{
				name: "outputMessages",
				type: "Message[]",
				required: true,
				description: "Current agent working memory messages",
			},
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages updated by the feature.",
			},
			{
				name: "outputMessages",
				type: "Message[]",
				description: "Working memory updated by the feature.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: AutoCompactSpec;
	}
}
