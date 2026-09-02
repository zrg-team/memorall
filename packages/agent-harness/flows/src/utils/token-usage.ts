import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type {
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionResponse,
} from "../interfaces/engine/messages.js";

export type TokenUsage = NonNullable<ChatCompletionResponse["usage"]>;

const DISABLE_LIBRARY_TOKEN_COUNT_ESTIMATION = true;
const MESSAGE_OVERHEAD_TOKENS = 4;
const CONVERSATION_OVERHEAD_TOKENS = 2;
const DEFAULT_TOKEN_MULTIPLIER = 3;

function estimateTokensFromText(text: string): number {
	if (!text) {
		return 0;
	}
	try {
		if (DISABLE_LIBRARY_TOKEN_COUNT_ESTIMATION) {
			return Math.max(1, Math.ceil(text.length / DEFAULT_TOKEN_MULTIPLIER));
		}
		return Math.max(1, encode(text).length);
	} catch {
		return Math.max(1, Math.ceil(text.length / DEFAULT_TOKEN_MULTIPLIER));
	}
}

function stringifyMessageContent(
	content: ChatCompletionMessageParam["content"] | null | undefined,
): string {
	if (!content) {
		return "";
	}

	if (typeof content === "string") {
		return content;
	}

	return content
		.map((part) => {
			if (part.type === "text") {
				return part.text;
			}

			if (part.type === "image_url") {
				return `[image:${part.image_url?.url || ""}]`;
			}

			return "";
		})
		.join("\n");
}

function stringifyMessage(message: ChatCompletionMessageParam): string {
	const parts: string[] = [message.role];

	if ("name" in message && message.name) {
		parts.push(message.name);
	}

	if ("content" in message) {
		parts.push(stringifyMessageContent(message.content));
	}

	if ("tool_calls" in message && message.tool_calls?.length) {
		parts.push(JSON.stringify(message.tool_calls));
	}

	if ("tool_call_id" in message && message.tool_call_id) {
		parts.push(message.tool_call_id);
	}

	return parts.filter(Boolean).join("\n");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const nonNegativeNumber = (value: unknown): number | undefined => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
		? parsed
		: undefined;
};

const firstNumber = (...values: unknown[]): number | undefined => {
	for (const value of values) {
		const parsed = nonNegativeNumber(value);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
};

/**
 * Flatten a provider usage object into {@link TokenUsage}.
 *
 * Besides the three OpenAI scalars this keeps the prompt-cache accounting,
 * which every dialect spells differently: OpenAI and OpenRouter nest it under
 * `prompt_tokens_details`, Anthropic-style gateways use
 * `cache_read_input_tokens` / `cache_creation_input_tokens`, and a usage that
 * already went through this function carries the flattened names. Reading all
 * of them means a usage survives the offscreen -> UI relay unchanged.
 */
export function normalizeTokenUsage(
	usage:
		| ChatCompletionResponse["usage"]
		| ChatCompletionChunk["usage"]
		| Record<string, unknown>
		| null
		| undefined,
): TokenUsage | undefined {
	if (!isRecord(usage)) {
		return undefined;
	}

	const promptTokens = Number(usage.prompt_tokens);
	const completionTokens = Number(usage.completion_tokens);
	const totalTokens = Number(usage.total_tokens);

	if (
		!Number.isFinite(promptTokens) ||
		!Number.isFinite(completionTokens) ||
		promptTokens < 0 ||
		completionTokens < 0
	) {
		return undefined;
	}

	const computedTotal = promptTokens + completionTokens;
	const normalizedTotal =
		Number.isFinite(totalTokens) && totalTokens >= 0
			? Math.max(totalTokens, computedTotal)
			: computedTotal;

	const promptDetails = isRecord(usage.prompt_tokens_details)
		? usage.prompt_tokens_details
		: {};
	const completionDetails = isRecord(usage.completion_tokens_details)
		? usage.completion_tokens_details
		: {};

	const cachedTokens = firstNumber(
		promptDetails.cached_tokens,
		usage.cache_read_input_tokens,
		usage.cached_tokens,
	);
	const cacheWriteTokens = firstNumber(
		promptDetails.cache_write_tokens,
		promptDetails.cache_creation_tokens,
		usage.cache_creation_input_tokens,
		usage.cache_write_tokens,
	);
	const reasoningTokens = firstNumber(
		completionDetails.reasoning_tokens,
		usage.reasoning_tokens,
	);
	const cost = nonNegativeNumber(usage.cost);

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: normalizedTotal,
		// A cache read can never exceed the prompt it was read for; some
		// gateways report the two from different counters.
		...(cachedTokens !== undefined
			? { cached_tokens: Math.min(cachedTokens, promptTokens) }
			: {}),
		...(cacheWriteTokens !== undefined
			? { cache_write_tokens: cacheWriteTokens }
			: {}),
		...(reasoningTokens !== undefined
			? { reasoning_tokens: reasoningTokens }
			: {}),
		...(cost !== undefined ? { cost } : {}),
		...(usage.estimated === true ? { estimated: true } : {}),
	};
}

/**
 * Share of the prompt that came out of the provider's cache, 0..1, or
 * undefined when the provider reported no cache activity at all.
 */
export function getCacheHitRatio(
	usage: Pick<TokenUsage, "prompt_tokens" | "cached_tokens"> | undefined,
): number | undefined {
	if (!usage || usage.cached_tokens === undefined) return undefined;
	if (usage.prompt_tokens <= 0) return 0;
	return Math.min(1, usage.cached_tokens / usage.prompt_tokens);
}

/**
 * Add one request's usage onto a running total. Optional fields only appear
 * in the sum once some request reported them, so a provider that never
 * mentions its cache does not show up as "0% cached".
 */
export function mergeTokenUsage(
	total: TokenUsage,
	incoming: TokenUsage,
): TokenUsage {
	const sumOptional = (
		key: "cached_tokens" | "cache_write_tokens" | "reasoning_tokens" | "cost",
	) =>
		total[key] === undefined && incoming[key] === undefined
			? {}
			: { [key]: (total[key] ?? 0) + (incoming[key] ?? 0) };

	return {
		prompt_tokens: total.prompt_tokens + incoming.prompt_tokens,
		completion_tokens: total.completion_tokens + incoming.completion_tokens,
		total_tokens: total.total_tokens + incoming.total_tokens,
		...sumOptional("cached_tokens"),
		...sumOptional("cache_write_tokens"),
		...sumOptional("reasoning_tokens"),
		...sumOptional("cost"),
		...(total.estimated || incoming.estimated ? { estimated: true } : {}),
	};
}

export function estimateMessageTokens(
	message: ChatCompletionMessageParam,
): number {
	return (
		MESSAGE_OVERHEAD_TOKENS + estimateTokensFromText(stringifyMessage(message))
	);
}

export function estimatePromptTokens(
	messages: ChatCompletionMessageParam[],
): number {
	if (!messages.length) {
		return 0;
	}

	return messages.reduce((total, message) => {
		return total + estimateMessageTokens(message);
	}, CONVERSATION_OVERHEAD_TOKENS);
}

export function extractResponseOutputText(
	response: Pick<ChatCompletionResponse, "choices">,
): string {
	return response.choices
		.map((choice) => {
			const parts: string[] = [];

			if (choice.message.content) {
				parts.push(choice.message.content);
			}

			if (choice.message.tool_calls?.length) {
				parts.push(JSON.stringify(choice.message.tool_calls));
			}

			return parts.join("\n");
		})
		.filter(Boolean)
		.join("\n");
}

export function extractChunkOutputText(
	chunk: Pick<ChatCompletionChunk, "choices">,
): string {
	return chunk.choices
		.map((choice) => {
			const parts: string[] = [];

			if (choice.delta.content) {
				parts.push(choice.delta.content);
			}

			if (choice.delta.tool_calls?.length) {
				parts.push(JSON.stringify(choice.delta.tool_calls));
			}

			return parts.join("\n");
		})
		.filter(Boolean)
		.join("\n");
}

export function chunkHasFinishReason(
	chunk: Pick<ChatCompletionChunk, "choices">,
): boolean {
	return chunk.choices.some(
		(choice) =>
			choice.finish_reason !== null && choice.finish_reason !== undefined,
	);
}

export function resolveTokenUsage(
	usage:
		| ChatCompletionResponse["usage"]
		| ChatCompletionChunk["usage"]
		| null
		| undefined,
	messages: ChatCompletionMessageParam[],
	completionOutput: string,
): TokenUsage {
	const normalizedUsage = normalizeTokenUsage(usage);
	if (
		normalizedUsage &&
		(normalizedUsage.total_tokens > 0 ||
			(messages.length === 0 && completionOutput.length === 0))
	) {
		return normalizedUsage;
	}

	const promptTokens = estimatePromptTokens(messages);
	const completionTokens = estimateTokensFromText(completionOutput);

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: promptTokens + completionTokens,
		estimated: true,
	};
}
