import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { logError, logInfo, logWarn } from "flow-core/utils/logger";
import { stepRegistry } from "flow-core/registries/step-registry";
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";
import type { BaseLLM } from "flow-core/interfaces/services/llm";
import type { BaseStateBase } from "flow-core/graph/graph.base";
import {
	estimatePromptTokens,
	estimateMessageTokens,
} from "flow-core/utils/token-usage";

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
const DEFAULT_KEEP_RECENT_OUTPUT_FLOWS = KEEP_RECENT_FLOWS;
const DEFAULT_CHAT_MESSAGE_TRIM_CONFIG = {
	stepPercent: 10,
	maxPercent: 80,
};
const DEFAULT_SMART_TRIM_CONFIG: PercentTrimConfig = {
	stepPercent: 100,
	maxPercent: 100,
};
const DEFAULT_MAX_ROUND_PERCENT_STEPS = [50, 100];
// Minimum base64 data length (chars) before we bother stripping it
const MIN_STRIP_BASE64_CHARS = 100;

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
	smartTrim: PercentTrimConfig;
	chatMessageTrim: PercentTrimConfig;
	maxRoundPercentSteps: number[];
	keepRecentOutputFlows: number;
};

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
		smartTrim: resolvePercentTrimConfig(
			config?.smartTrim,
			DEFAULT_SMART_TRIM_CONFIG,
		),
		chatMessageTrim: resolvePercentTrimConfig(
			config?.chatMessageTrim,
			DEFAULT_CHAT_MESSAGE_TRIM_CONFIG,
		),
		maxRoundPercentSteps: resolveMaxRoundPercentSteps(
			config?.maxRoundPercentSteps,
		),
		keepRecentOutputFlows: clampNonNegativeInteger(
			config?.keepRecentOutputFlows,
			DEFAULT_KEEP_RECENT_OUTPUT_FLOWS,
		),
	};
}

function estimateStateTokens(state: AutoCompactState): number {
	return estimatePromptTokens([...state.messages, ...state.outputMessages]);
}

function logTokenBreakdown(state: AutoCompactState): void {
	const rows: Array<{
		key: string;
		i: number;
		role: string;
		label: string;
		contentChars: number;
		toolCallArgChars: number;
		tokens: number;
	}> = [];

	for (const [key, msgs] of [
		["messages", state.messages],
		["outputMessages", state.outputMessages],
	] as const) {
		for (let i = 0; i < msgs.length; i++) {
			const m = msgs[i];
			const contentChars =
				typeof m.content === "string"
					? m.content.length
					: Array.isArray(m.content)
						? m.content
								.map((p) => ("text" in p ? (p as { text: string }).text : ""))
								.join("").length
						: 0;
			const toolCallArgChars =
				"tool_calls" in m && Array.isArray(m.tool_calls)
					? JSON.stringify(m.tool_calls).length
					: 0;
			const label =
				"tool_calls" in m && m.tool_calls?.[0]
					? `assistant→${m.tool_calls.map((tc) => tc.function.name).join(",")}`
					: "tool_call_id" in m
						? `tool[${(m as { tool_call_id: string }).tool_call_id}]`
						: m.role;
			rows.push({
				key,
				i,
				role: m.role,
				label,
				contentChars,
				toolCallArgChars,
				tokens: estimateMessageTokens(m),
			});
		}
	}

	logAutoCompact("token_breakdown", {
		totalTokens: estimateStateTokens(state),
		messageCount: state.messages.length,
		outputMessageCount: state.outputMessages.length,
		rows,
	});
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

// Returns true if `text` contains a base64 data URI long enough to be worth stripping.
function hasBase64DataUri(text: string): boolean {
	return new RegExp(
		`data:[^;,"'\\s\\\\]+;base64,[A-Za-z0-9+/]{${MIN_STRIP_BASE64_CHARS},}`,
	).test(text);
}

// Replaces base64 data URIs in `text` with compact placeholders.
function stripBase64DataUris(text: string): string {
	return text.replace(
		/data:([^;,"'\s\\]+);base64,([A-Za-z0-9+/]+=*)/g,
		(_, mime: string, data: string) =>
			data.length >= MIN_STRIP_BASE64_CHARS
				? `data:${mime};base64,[~${data.length}chars]`
				: `data:${mime};base64,${data}`,
	);
}

function isBase64Strippable(message: ChatCompletionMessageParam): boolean {
	if (typeof message.content === "string" && hasBase64DataUri(message.content))
		return true;
	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (part.type === "text" && hasBase64DataUri(part.text)) return true;
			if (
				part.type === "image_url" &&
				part.image_url?.url &&
				hasBase64DataUri(part.image_url.url)
			)
				return true;
		}
	}
	if ("tool_calls" in message && message.tool_calls?.length) {
		for (const tc of message.tool_calls) {
			if (hasBase64DataUri(tc.function.arguments)) return true;
		}
	}
	return false;
}

function stripBase64FromMessage(
	message: ChatCompletionMessageParam,
): ChatCompletionMessageParam {
	let m = message;
	if (typeof m.content === "string" && hasBase64DataUri(m.content)) {
		m = { ...m, content: stripBase64DataUris(m.content) };
	}
	if (Array.isArray(m.content)) {
		const newParts = m.content.map((part) => {
			if (part.type === "text" && hasBase64DataUri(part.text)) {
				return { ...part, text: stripBase64DataUris(part.text) };
			}
			if (
				part.type === "image_url" &&
				part.image_url?.url &&
				hasBase64DataUri(part.image_url.url)
			) {
				return {
					...part,
					image_url: {
						...part.image_url,
						url: stripBase64DataUris(part.image_url.url),
					},
				};
			}
			return part;
		});
		m = { ...m, content: newParts } as ChatCompletionMessageParam;
	}
	if ("tool_calls" in m && m.tool_calls?.length) {
		const newToolCalls = m.tool_calls.map((tc) => {
			if (!hasBase64DataUri(tc.function.arguments)) return tc;
			return {
				...tc,
				function: {
					...tc.function,
					arguments: stripBase64DataUris(tc.function.arguments),
				},
			};
		});
		m = { ...m, tool_calls: newToolCalls } as typeof m;
	}
	return m;
}

function countBase64StrippableMessages(
	state: AutoCompactState,
	key: AutoCompactStateKey,
): number {
	return state[key].filter(isBase64Strippable).length;
}

function stripOldestBase64Messages(
	state: AutoCompactState,
	count: number,
	key: AutoCompactStateKey,
): { state: AutoCompactState; affectedCount: number } {
	if (count <= 0) return { state, affectedCount: 0 };
	let remaining = count;
	let affectedCount = 0;
	const nextMessages = state[key].map((m) => {
		if (remaining <= 0 || !isBase64Strippable(m)) return m;
		remaining--;
		affectedCount++;
		return stripBase64FromMessage(m);
	});
	return { state: { ...state, [key]: nextMessages }, affectedCount };
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
	let activePercent = Math.min(
		stage.config.stepPercent,
		stage.config.maxPercent,
	);

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
		const keepRecent =
			key === "outputMessages" ? config.keepRecentOutputFlows : 0;
		return {
			name: "tool_call_flow",
			logEvent: "remove_tool_call_flow_percent",
			config: config.toolCallFlowTrim,
			key,
			getEligibleCount: (s) =>
				Math.max(0, countToolCallFlows(s, key) - keepRecent),
			applyCount: (s, count) => removeOldestToolCallFlows(s, count, key),
		};
	}

	function makeSmartTrimStage(key: AutoCompactStateKey): PercentTrimStage {
		return {
			name: "smart_trim_base64",
			logEvent: "smart_trim_base64_percent",
			config: config.smartTrim,
			key,
			getEligibleCount: (s) => countBase64StrippableMessages(s, key),
			applyCount: (s, count) => stripOldestBase64Messages(s, count, key),
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
	// Within each key: escalating rounds of toolResult → toolCallFlow → smartTrim
	// (least destructive first), then chatMessage as last resort only after all
	// rounds are exhausted.
	for (const key of ["messages", "outputMessages"] as const) {
		for (const roundCap of config.maxRoundPercentSteps) {
			if (runCapped(makeToolResultStage(key), roundCap)) return nextState;
			if (runCapped(makeToolCallFlowStage(key), roundCap)) return nextState;
			if (runCapped(makeSmartTrimStage(key), roundCap)) return nextState;
		}
		if (runStage(makeChatStage(key))) return nextState;
	}

	return nextState;
}

export function applyAutoCompactPolicy(
	state: AutoCompactState,
	config: AutoCompactConfig | undefined,
	maxTokens: number,
): AutoCompactState | undefined {
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
	logTokenBreakdown(state);

	const compactedState = trimToSafeThreshold(
		state,
		safeTokenThreshold,
		resolvedConfig,
	);
	const afterTrimTokens = estimateStateTokens(compactedState);

	logAutoCompact("after_trim", {
		beforeTokens: initialTokens,
		afterTokens: afterTrimTokens,
		safeTokenThreshold,
		state: summarizeState(compactedState),
	});

	if (afterTrimTokens > safeTokenThreshold) {
		logWarn(
			`[AUTO_COMPACT] Context still exceeds budget after full trim: ${afterTrimTokens} tokens > ${safeTokenThreshold} safe limit. Returning best-effort compacted state.`,
		);
	}

	logAutoCompact("policy_done", {
		beforeTokens: initialTokens,
		afterTokens: afterTrimTokens,
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
	keepRecentOutputFlows?: number;
	smartTrim?: Partial<PercentTrimConfig>;
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
					return applyAutoCompactPolicy(
						{
							messages: agentState.messages,
							outputMessages: agentState.outputMessages,
						},
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
		{
			key: "keepRecentOutputFlows",
			type: "number",
			default: DEFAULT_KEEP_RECENT_OUTPUT_FLOWS,
			description:
				"Number of most-recent tool-call flows in outputMessages to protect from direct removal. Mirrors the KEEP_RECENT_FLOWS guard in the LLM summarization path.",
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
