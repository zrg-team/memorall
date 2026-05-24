import type {
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionResponse,
} from "../interfaces/messages";

export type TokenUsage = NonNullable<ChatCompletionResponse["usage"]>;

const ESTIMATED_CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;
const CONVERSATION_OVERHEAD_TOKENS = 2;

function estimateTokensFromText(text: string): number {
	if (!text) {
		return 0;
	}

	return Math.max(1, Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN));
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

export function normalizeTokenUsage(
	usage:
		| ChatCompletionResponse["usage"]
		| ChatCompletionChunk["usage"]
		| null
		| undefined,
): TokenUsage | undefined {
	if (!usage) {
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

	return {
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: normalizedTotal,
	};
}

export function estimatePromptTokens(
	messages: ChatCompletionMessageParam[],
): number {
	if (!messages.length) {
		return 0;
	}

	return messages.reduce((total, message) => {
		return (
			total +
			MESSAGE_OVERHEAD_TOKENS +
			estimateTokensFromText(stringifyMessage(message))
		);
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
	};
}
