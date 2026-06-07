import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { logError, logInfo } from "flow-core/utils/logger";
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
const CHUNKED_TOOL_RESULT_MARKER = "[... chunked tool result:";
// Number of complete tool-call flows to keep verbatim in outputMessages
const KEEP_RECENT_FLOWS = 2;
const DEFAULT_TOOL_RESULT_TRIM_CONFIG = {
	stepPercent: 20,
	maxPercent: 100,
	chunkHeadChars: 1000,
	chunkTailChars: 1000,
};
const DEFAULT_TOOL_CALL_FLOW_TRIM_CONFIG = {
	stepPercent: 20,
	maxPercent: 80,
};
const DEFAULT_CHAT_MESSAGE_TRIM_CONFIG = {
	stepPercent: 10,
	maxPercent: 80,
};
const DEFAULT_MAX_ROUND_PERCENT_STEPS = [50, 100];

type AutoCompactState = Pick<BaseStateBase, "messages" | "outputMessages">;
type AutoCompactStateKey = keyof AutoCompactState;
type PercentTrimConfig = {
	stepPercent: number;
	maxPercent: number;
};
type ToolResultTrimConfig = PercentTrimConfig & {
	chunkHeadChars: number;
	chunkTailChars: number;
};

type ResolvedAutoCompactConfig = {
	compactThresholdRatio: number;
	safeThresholdRatio: number;
	toolResultTrim: ToolResultTrimConfig;
	toolCallFlowTrim: PercentTrimConfig;
	chatMessageTrim: PercentTrimConfig;
	maxRoundPercentSteps: number[];
};

function getContentCharLength(message: ChatCompletionMessageParam): number {
	return extractText(message).length;
}

function summarizeMessage(
	message: ChatCompletionMessageParam,
): Record<string, unknown> {
	if (message.role === "assistant") {
		return {
			role: message.role,
			contentChars: getContentCharLength(message),
			toolCalls: message.tool_calls?.map((toolCall) => ({
				id: toolCall.id,
				name: toolCall.function.name,
				argumentChars: toolCall.function.arguments.length,
			})),
		};
	}

	if (message.role === "tool") {
		return {
			role: message.role,
			toolCallId: message.tool_call_id,
			contentChars: getContentCharLength(message),
			trimmed:
				isChunkedToolResult(message) || isLegacyTrimmedToolResult(message),
		};
	}

	return {
		role: message.role,
		contentChars: getContentCharLength(message),
	};
}

function summarizeMessageList(
	messages: ChatCompletionMessageParam[],
): Record<string, number> {
	return messages.reduce(
		(counts, message) => {
			counts.total++;
			counts[message.role]++;
			if (message.role === "assistant" && message.tool_calls?.length) {
				counts.assistantToolCalls += message.tool_calls?.length ?? 0;
			}
			if (message.role === "tool") {
				counts.toolResults++;
				if (
					isChunkedToolResult(message) ||
					isLegacyTrimmedToolResult(message)
				) {
					counts.trimmedToolResults++;
				}
			}
			return counts;
		},
		{
			total: 0,
			system: 0,
			user: 0,
			assistant: 0,
			tool: 0,
			assistantToolCalls: 0,
			toolResults: 0,
			trimmedToolResults: 0,
		},
	);
}

function summarizeState(state: AutoCompactState): Record<string, unknown> {
	return {
		estimatedTokens: estimateStateTokens(state),
		messages: summarizeMessageList(state.messages),
		outputMessages: summarizeMessageList(state.outputMessages),
	};
}

function logAutoCompact(
	event: string,
	details?: Record<string, unknown>,
): void {
	logInfo(`[AUTO_COMPACT] ${event}`, details);
}

const clampRatio = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(0.95, Math.max(0.05, value));
};

const clampPercent = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(100, Math.max(0, value));
};

const clampPositiveStepPercent = (value: unknown, fallback: number): number => {
	const percent = clampPercent(value, fallback);
	return percent > 0 ? percent : fallback;
};

const clampNonNegativeInteger = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.floor(value));
};

function resolvePercentTrimConfig(
	config: Partial<PercentTrimConfig> | undefined,
	defaultConfig: PercentTrimConfig,
): PercentTrimConfig {
	const stepPercent = clampPositiveStepPercent(
		config?.stepPercent,
		defaultConfig.stepPercent,
	);
	const maxPercent = clampPercent(config?.maxPercent, defaultConfig.maxPercent);
	return { stepPercent, maxPercent };
}

function resolveToolResultTrimConfig(
	config: AutoCompactConfig["toolResultTrim"],
): ToolResultTrimConfig {
	return {
		...resolvePercentTrimConfig(config, DEFAULT_TOOL_RESULT_TRIM_CONFIG),
		chunkHeadChars: clampNonNegativeInteger(
			config?.chunkHeadChars,
			DEFAULT_TOOL_RESULT_TRIM_CONFIG.chunkHeadChars,
		),
		chunkTailChars: clampNonNegativeInteger(
			config?.chunkTailChars,
			DEFAULT_TOOL_RESULT_TRIM_CONFIG.chunkTailChars,
		),
	};
}

function resolveMaxRoundPercentSteps(steps: unknown): number[] {
	if (!Array.isArray(steps) || steps.length === 0) {
		return DEFAULT_MAX_ROUND_PERCENT_STEPS;
	}
	const valid = steps
		.filter((v) => typeof v === "number" && Number.isFinite(v))
		.map((v) => clampPercent(v, 100))
		.filter((v): v is number => v > 0)
		.filter((v, i, arr) => arr.indexOf(v) === i)
		.sort((a, b) => a - b);
	return valid.length > 0 ? valid : DEFAULT_MAX_ROUND_PERCENT_STEPS;
}

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
	return {
		compactThresholdRatio,
		safeThresholdRatio,
		toolResultTrim: resolveToolResultTrimConfig(config?.toolResultTrim),
		toolCallFlowTrim: resolvePercentTrimConfig(
			config?.toolCallFlowTrim,
			DEFAULT_TOOL_CALL_FLOW_TRIM_CONFIG,
		),
		chatMessageTrim: resolvePercentTrimConfig(
			config?.chatMessageTrim,
			DEFAULT_CHAT_MESSAGE_TRIM_CONFIG,
		),
		maxRoundPercentSteps: resolveMaxRoundPercentSteps(
			config?.maxRoundPercentSteps,
		),
	};
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

function isLegacyTrimmedToolResult(
	message: ChatCompletionMessageParam,
): boolean {
	return (
		message.role === "tool" &&
		extractText(message).trim() === TRIMMED_TOOL_RESULT_CONTENT
	);
}

function isChunkedToolResult(message: ChatCompletionMessageParam): boolean {
	return (
		message.role === "tool" &&
		typeof message.content === "string" &&
		message.content.includes(CHUNKED_TOOL_RESULT_MARKER)
	);
}

function isChunkableToolResult(
	message: ChatCompletionMessageParam,
	config: ToolResultTrimConfig,
): boolean {
	if (
		message.role !== "tool" ||
		isChunkedToolResult(message) ||
		isLegacyTrimmedToolResult(message)
	) {
		return false;
	}
	return (
		extractText(message).length > config.chunkHeadChars + config.chunkTailChars
	);
}

function chunkToolResultContent(
	content: string,
	config: ToolResultTrimConfig,
): string {
	const head = content.slice(0, config.chunkHeadChars);
	const tail =
		config.chunkTailChars > 0 ? content.slice(-config.chunkTailChars) : "";
	const omittedChars = Math.max(0, content.length - head.length - tail.length);
	return `${head}\n\n${CHUNKED_TOOL_RESULT_MARKER} originalChars=${content.length}, omittedChars=${omittedChars} ...]\n\n${tail}`;
}

function countForPercent(total: number, percent: number): number {
	if (total <= 0 || percent <= 0) {
		return 0;
	}
	return Math.min(total, Math.max(1, Math.ceil((total * percent) / 100)));
}

function countChunkableToolResults(
	state: AutoCompactState,
	config: ToolResultTrimConfig,
	key: AutoCompactStateKey,
): number {
	return state[key].filter((message) => isChunkableToolResult(message, config))
		.length;
}

function chunkOldestToolResults(
	state: AutoCompactState,
	count: number,
	config: ToolResultTrimConfig,
	key: AutoCompactStateKey,
): { state: AutoCompactState; affectedCount: number } {
	if (count <= 0) {
		return { state, affectedCount: 0 };
	}

	let remaining = count;
	let affectedCount = 0;
	const nextState: AutoCompactState = {
		...state,
		messages: state.messages,
		outputMessages: state.outputMessages,
	};

	nextState[key] = nextState[key].map((message) => {
		if (remaining <= 0 || !isChunkableToolResult(message, config)) {
			return message;
		}

		remaining--;
		affectedCount++;
		return {
			...message,
			content: chunkToolResultContent(extractText(message), config),
		};
	});

	return { state: nextState, affectedCount };
}

function countToolCallFlows(
	state: AutoCompactState,
	key: AutoCompactStateKey,
): number {
	return state[key].filter(hasToolCalls).length;
}

function removeOldestToolCallFlowOnce(
	state: AutoCompactState,
	key: AutoCompactStateKey,
): {
	state: AutoCompactState;
	affectedCount: number;
} {
	const index = state[key].findIndex(hasToolCalls);
	if (index === -1) return { state, affectedCount: 0 };

	const assistantMessage = state[key][index];
	if (
		assistantMessage.role !== "assistant" ||
		!assistantMessage.tool_calls?.length
	) {
		return { state, affectedCount: 0 };
	}

	const toolCallIds = new Set(
		assistantMessage.tool_calls.map((toolCall) => toolCall.id),
	);
	const nextMessages = state.messages.filter(
		(message, messageIndex) =>
			!(
				key === "messages" &&
				messageIndex === index &&
				message.role === "assistant"
			) && !(message.role === "tool" && toolCallIds.has(message.tool_call_id)),
	);
	const nextOutputMessages = state.outputMessages.filter(
		(message, messageIndex) =>
			!(
				key === "outputMessages" &&
				messageIndex === index &&
				message.role === "assistant"
			) && !(message.role === "tool" && toolCallIds.has(message.tool_call_id)),
	);

	return {
		state: {
			messages: nextMessages,
			outputMessages: nextOutputMessages,
		},
		affectedCount: 1,
	};
}

function removeOldestToolCallFlows(
	state: AutoCompactState,
	count: number,
	key: AutoCompactStateKey,
): { state: AutoCompactState; affectedCount: number } {
	let nextState = state;
	let affectedCount = 0;

	for (let i = 0; i < count; i++) {
		const result = removeOldestToolCallFlowOnce(nextState, key);
		if (result.affectedCount === 0) break;
		nextState = result.state;
		affectedCount += result.affectedCount;
	}

	return { state: nextState, affectedCount };
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
	key: AutoCompactStateKey,
): {
	state: AutoCompactState;
	affectedCount: number;
} {
	const latestUserRef = getLatestUserRef(state);

	const index = state[key].findIndex((message, messageIndex) => {
		if (message.role === "user") {
			return !(
				latestUserRef?.key === key && latestUserRef.index === messageIndex
			);
		}
		return message.role === "assistant" && !message.tool_calls?.length;
	});
	if (index === -1) return { state, affectedCount: 0 };

	return {
		state: {
			...state,
			[key]: state[key].filter((_, messageIndex) => messageIndex !== index),
		},
		affectedCount: 1,
	};
}

function countChatMessages(
	state: AutoCompactState,
	key: AutoCompactStateKey,
): number {
	const latestUserRef = getLatestUserRef(state);

	return state[key].filter((message, messageIndex) => {
		if (message.role === "user") {
			return !(
				latestUserRef?.key === key && latestUserRef.index === messageIndex
			);
		}
		return message.role === "assistant" && !message.tool_calls?.length;
	}).length;
}

function removeOldestChatMessages(
	state: AutoCompactState,
	count: number,
	key: AutoCompactStateKey,
): { state: AutoCompactState; affectedCount: number } {
	let nextState = state;
	let affectedCount = 0;

	for (let i = 0; i < count; i++) {
		const result = trimOldestChatMessage(nextState, key);
		if (result.affectedCount === 0) break;
		nextState = result.state;
		affectedCount += result.affectedCount;
	}

	return { state: nextState, affectedCount };
}

type PercentTrimStage = {
	name: string;
	logEvent: string;
	config: PercentTrimConfig;
	key: AutoCompactStateKey;
	getEligibleCount: (state: AutoCompactState) => number;
	applyCount: (
		state: AutoCompactState,
		count: number,
	) => { state: AutoCompactState; affectedCount: number };
};

function runPercentTrimStage(
	state: AutoCompactState,
	safeTokenThreshold: number,
	stage: PercentTrimStage,
): { state: AutoCompactState; reachedSafeThreshold: boolean } {
	let nextState = state;
	const eligibleCount = stage.getEligibleCount(nextState);
	let affectedTotal = 0;
	// Start at stepPercent clamped to maxPercent — no initialPercent needed since
	// rounds provide the coarse escalation and stepPercent gives within-round precision.
	let activePercent = Math.min(stage.config.stepPercent, stage.config.maxPercent);

	while (true) {
		const beforeTokens = estimateStateTokens(nextState);
		const targetCount = countForPercent(eligibleCount, activePercent);
		const countToApply = Math.max(0, targetCount - affectedTotal);
		const result = stage.applyCount(nextState, countToApply);
		nextState = result.state;
		affectedTotal += result.affectedCount;
		const afterTokens = estimateStateTokens(nextState);

		logAutoCompact(stage.logEvent, {
			category: stage.name,
			key: stage.key,
			activePercent,
			maxPercent: stage.config.maxPercent,
			eligibleCount,
			affectedCount: result.affectedCount,
			affectedTotal,
			beforeTokens,
			afterTokens,
			safeTokenThreshold,
		});

		if (afterTokens <= safeTokenThreshold) {
			return { state: nextState, reachedSafeThreshold: true };
		}

		if (
			activePercent >= stage.config.maxPercent ||
			eligibleCount === 0 ||
			affectedTotal >= eligibleCount
		) {
			break;
		}

		activePercent = Math.min(
			stage.config.maxPercent,
			activePercent + stage.config.stepPercent,
		);
	}

	return { state: nextState, reachedSafeThreshold: false };
}

function trimToSafeThreshold(
	state: AutoCompactState,
	safeTokenThreshold: number,
	config: ResolvedAutoCompactConfig,
): AutoCompactState {
	let nextState = state;

	function isSafe(): boolean {
		return estimateStateTokens(nextState) <= safeTokenThreshold;
	}

	function runStage(stage: PercentTrimStage): boolean {
		if (isSafe()) return true;
		const result = runPercentTrimStage(nextState, safeTokenThreshold, stage);
		nextState = result.state;
		return result.reachedSafeThreshold;
	}

	// Override maxPercent with the round cap. Each round restarts fresh so
	// eligibleCount is re-read from current state and affectedTotal resets to 0.
	function runCapped(stage: PercentTrimStage, roundCap: number): boolean {
		return runStage({
			...stage,
			config: {
				...stage.config,
				maxPercent: Math.min(stage.config.maxPercent, roundCap),
			},
		});
	}

	function makeToolResultStage(key: AutoCompactStateKey): PercentTrimStage {
		return {
			name: "tool_result",
			logEvent: "trim_tool_result_percent",
			config: config.toolResultTrim,
			key,
			getEligibleCount: (s) =>
				countChunkableToolResults(s, config.toolResultTrim, key),
			applyCount: (s, count) =>
				chunkOldestToolResults(s, count, config.toolResultTrim, key),
		};
	}

	function makeToolCallFlowStage(key: AutoCompactStateKey): PercentTrimStage {
		return {
			name: "tool_call_flow",
			logEvent: "remove_tool_call_flow_percent",
			config: config.toolCallFlowTrim,
			key,
			getEligibleCount: (s) => countToolCallFlows(s, key),
			applyCount: (s, count) => removeOldestToolCallFlows(s, count, key),
		};
	}

	function makeChatStage(key: AutoCompactStateKey): PercentTrimStage {
		return {
			name: "chat_message",
			logEvent: "remove_chat_message_percent",
			config: config.chatMessageTrim,
			key,
			getEligibleCount: (s) => countChatMessages(s, key),
			applyCount: (s, count) => removeOldestChatMessages(s, count, key),
		};
	}

	// Process messages fully before touching outputMessages.
	// Within each key: escalating rounds of toolResult+toolCallFlow (least destructive),
	// then chatMessage as last resort only after all rounds are exhausted.
	for (const key of ["messages", "outputMessages"] as const) {
		for (const roundCap of config.maxRoundPercentSteps) {
			if (runCapped(makeToolResultStage(key), roundCap)) return nextState;
			if (runCapped(makeToolCallFlowStage(key), roundCap)) return nextState;
		}
		if (runStage(makeChatStage(key))) return nextState;
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
		logAutoCompact("compact_history_start", {
			inputMessages: summarizeMessageList(messages),
			toSummarize: summarizeMessageList(toSummarize),
			preservedLastUser: summarizeMessage(lastUserMessage),
		});
		const summary = await summarize(toSummarize, llm);
		logAutoCompact("compact_history_done", {
			summaryChars: summary.length,
			outputMessages: systemMessages.length + 2,
		});
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
		logAutoCompact("compact_output_start", {
			flows: flows.length,
			flowsSummarized: flows.length - KEEP_RECENT_FLOWS,
			flowsKept: KEEP_RECENT_FLOWS,
			toSummarize: summarizeMessageList(toSummarize),
			toKeep: summarizeMessageList(toKeep),
		});
		const summary = await summarize(toSummarize, llm);
		logAutoCompact("compact_output_done", {
			summaryChars: summary.length,
			outputMessages: toKeep.length + 1,
		});
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
	const initialTokens = estimateStateTokens(state);

	if (initialTokens <= compactTokenThreshold) {
		return undefined;
	}

	logAutoCompact("policy_triggered", {
		estimatedTokens: initialTokens,
		compactTokenThreshold,
		safeTokenThreshold,
	});

	let compactedState = trimToSafeThreshold(
		state,
		safeTokenThreshold,
		resolvedConfig,
	);
	const afterDirectTrimTokens = estimateStateTokens(compactedState);
	logAutoCompact("after_direct_trim", {
		beforeTokens: initialTokens,
		afterTokens: afterDirectTrimTokens,
		safeTokenThreshold,
		state: summarizeState(compactedState),
	});

	if (afterDirectTrimTokens <= safeTokenThreshold) {
		logAutoCompact("policy_done_after_direct_trim", {
			beforeTokens: initialTokens,
			afterTokens: afterDirectTrimTokens,
			state: summarizeState(compactedState),
		});
		return compactedState;
	}

	logAutoCompact("summarization_required", {
		estimatedTokens: afterDirectTrimTokens,
		safeTokenThreshold,
		state: summarizeState(compactedState),
	});

	const [compactedMessages, compactedOutput] = await Promise.all([
		compactHistory(compactedState.messages, llm),
		compactOutputMessages(compactedState.outputMessages, llm),
	]);

	logAutoCompact("after_summarization", {
		messages: summarizeMessageList(compactedMessages),
		outputMessages: summarizeMessageList(compactedOutput),
	});

	compactedState = trimToSafeThreshold(
		{
			messages: compactedMessages,
			outputMessages: compactedOutput,
		},
		safeTokenThreshold,
		resolvedConfig,
	);

	logAutoCompact("policy_done", {
		beforeTokens: initialTokens,
		afterTokens: estimateStateTokens(compactedState),
		state: summarizeState(compactedState),
	});

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
	toolResultTrim?: Partial<ToolResultTrimConfig>;
	toolCallFlowTrim?: Partial<PercentTrimConfig>;
	chatMessageTrim?: Partial<PercentTrimConfig>;
	maxRoundPercentSteps?: number[];
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
		{
			key: "maxRoundPercentSteps",
			type: "array",
			default: DEFAULT_MAX_ROUND_PERCENT_STEPS,
			description:
				"Escalation caps per round. Each round runs toolResult then toolCallFlow up to that cap before moving to the next round. Chat messages are only trimmed after all rounds are exhausted.",
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
