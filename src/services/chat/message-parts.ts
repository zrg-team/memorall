import type {
	ChatCompletionChunk,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
} from "@/types/openai";
import type { MessageParts } from "@/types/chat";
import {
	accumulateChunkToolCalls,
	createToolCallAccumulator,
	type ToolCallAccumulator,
} from "@/services/chat/tool-call-accumulator";

type AssistantPart = Extract<ChatCompletionMessageParam, { role: "assistant" }>;
type ToolPart = Extract<ChatCompletionMessageParam, { role: "tool" }>;

const isAssistantOrToolMessage = (
	message: unknown,
): message is AssistantPart | ToolPart => {
	if (!message || typeof message !== "object") return false;
	if (!("role" in message)) return false;
	return message.role === "assistant" || message.role === "tool";
};

export const getOutputMessageParts = (
	finalState: Record<string, unknown> | null | undefined,
): MessageParts => {
	const outputMessages = finalState?.outputMessages;
	if (!Array.isArray(outputMessages)) return [];
	return outputMessages.filter(isAssistantOrToolMessage);
};

export const cloneMessageParts = (
	parts: MessageParts | null | undefined,
): MessageParts | null =>
	parts
		? parts.map((part) => ({
				...part,
				...(part.role === "assistant" && part.tool_calls
					? {
							tool_calls: part.tool_calls.map((toolCall) => ({
								...toolCall,
								function: { ...toolCall.function },
							})),
						}
					: {}),
			}))
		: null;

export const resolveMessageParts = ({
	finalState,
	accumulatedParts,
}: {
	finalState?: Record<string, unknown> | null;
	accumulatedParts: MessageParts;
}): MessageParts => {
	const outputMessageParts = getOutputMessageParts(finalState);
	if (outputMessageParts.length === 0) return accumulatedParts;
	// An agent graph ends with only its final message in `outputMessages`; every
	// intermediate turn and tool result was already committed elsewhere. Taking
	// that list would drop the text written between tool calls, and the stored
	// message could no longer be read back in the order it happened.
	const outputToolCallIds = new Set(
		outputMessageParts.flatMap((part) =>
			part.role === "tool" ? [part.tool_call_id] : [],
		),
	);
	const dropsStreamedTools = accumulatedParts.some(
		(part) => part.role === "tool" && !outputToolCallIds.has(part.tool_call_id),
	);
	if (
		dropsStreamedTools ||
		outputMessageParts.length < accumulatedParts.length
	) {
		return accumulatedParts;
	}
	return outputMessageParts;
};

export class MessagePartsAccumulator {
	private readonly parts: MessageParts = [];
	private readonly assistantToolCalls = new Map<number, ToolCallAccumulator>();
	private currentAssistantIndex: number | null = null;

	addChunk(chunk: ChatCompletionChunk): void {
		for (const choice of chunk.choices ?? []) {
			const delta = choice.delta;
			if (!delta) continue;

			if (delta.role === "tool" || delta.tool_call_id) {
				this.appendToolContent(delta.tool_call_id, delta.content ?? "");
				continue;
			}

			if (
				delta.role === "assistant" ||
				delta.content !== undefined ||
				delta.tool_calls?.length
			) {
				const assistant = this.ensureAssistantPart();
				if (delta.content) {
					assistant.content = `${assistant.content ?? ""}${delta.content}`;
				}
				if (delta.tool_calls?.length) {
					this.mergeToolCallDeltas(delta.tool_calls);
				}
			}
		}
	}

	toParts(): MessageParts {
		return cloneMessageParts(this.parts) ?? [];
	}

	private ensureAssistantPart(): AssistantPart {
		const last = this.parts[this.parts.length - 1];
		if (last?.role === "assistant") {
			this.currentAssistantIndex = this.parts.length - 1;
			return last;
		}

		const part: AssistantPart = { role: "assistant", content: "" };
		this.parts.push(part);
		this.currentAssistantIndex = this.parts.length - 1;
		return part;
	}

	private appendToolContent(
		toolCallId: string | undefined,
		content: string | null | undefined,
	): void {
		if (!toolCallId) return;
		this.currentAssistantIndex = null;

		const last = this.parts[this.parts.length - 1];
		if (last?.role === "tool" && last.tool_call_id === toolCallId) {
			last.content = `${last.content ?? ""}${content ?? ""}`;
			return;
		}

		this.parts.push({
			role: "tool",
			content: content ?? "",
			tool_call_id: toolCallId,
		});
	}

	private mergeToolCallDeltas(
		toolCalls: Parameters<typeof accumulateChunkToolCalls>[1],
	): void {
		if (this.currentAssistantIndex === null) return;
		const assistant = this.parts[this.currentAssistantIndex];
		if (assistant?.role !== "assistant") return;

		let calls = this.assistantToolCalls.get(this.currentAssistantIndex);
		if (!calls) {
			calls = createToolCallAccumulator();
			this.assistantToolCalls.set(this.currentAssistantIndex, calls);
		}

		accumulateChunkToolCalls(calls, toolCalls);
		assistant.tool_calls = Array.from(calls.values());
	}
}
