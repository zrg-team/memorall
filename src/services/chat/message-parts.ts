import { formatFlowRunInboxMessage } from "@memorall/agent-harness-flows/context/run-inbox";
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
type UserPart = Extract<ChatCompletionMessageParam, { role: "user" }>;

/**
 * A reply's parts: what the agent wrote, its tools, what the user sent
 * meanwhile, and the reminders the run attached for the model.
 */
const isReplyPart = (
	message: unknown,
): message is AssistantPart | ToolPart | UserPart => {
	if (!message || typeof message !== "object") return false;
	if (!("role" in message)) return false;
	return (
		message.role === "assistant" ||
		message.role === "tool" ||
		message.role === "user"
	);
};

/**
 * Whether the parts hold the reply itself — something the agent wrote or a
 * tool it ran — rather than only the reminders kept for the model. Nearly
 * every run attaches a reminder, so "has parts" no longer means "has an
 * answer": a reply that was not streamed, or failed before its first token,
 * has parts and nothing in them to read.
 */
export const hasReplyParts = (
	parts: MessageParts | null | undefined,
): boolean =>
	Array.isArray(parts) &&
	parts.some((part) => part.role === "assistant" || part.role === "tool");

/**
 * The parts to store for a reply whose text only reached `content` — a
 * completion that was not streamed — with that text added as the assistant's
 * part after the reminders. The next turn replays a reply's parts, not its
 * content, so parts without it would replay the reminders and lose the answer.
 */
export const withReplyText = (
	parts: MessageParts,
	content: string,
): MessageParts =>
	parts.length > 0 && !hasReplyParts(parts) && content.trim()
		? [...parts, { role: "assistant", content }]
		: parts;

export const getOutputMessageParts = (
	finalState: Record<string, unknown> | null | undefined,
): MessageParts => {
	const outputMessages = finalState?.outputMessages;
	if (!Array.isArray(outputMessages)) return [];
	return outputMessages.filter(isReplyPart);
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

/**
 * The graph's own messages never carry reasoning — it only ever reached the
 * stream — so take it from the streamed part in the same place.
 */
const withStreamedReasoning = (
	parts: MessageParts,
	streamed: MessageParts,
): MessageParts =>
	parts.map((part, index) => {
		const source = streamed[index];
		return part.role === "assistant" &&
			!part.reasoning &&
			source?.role === "assistant" &&
			source.reasoning
			? { ...part, reasoning: source.reasoning }
			: part;
	});

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
	return withStreamedReasoning(outputMessageParts, accumulatedParts);
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
				delta.reasoning ||
				delta.tool_calls?.length
			) {
				const assistant = this.ensureAssistantPart();
				if (delta.reasoning) {
					assistant.reasoning = `${assistant.reasoning ?? ""}${delta.reasoning}`;
				}
				if (delta.content) {
					assistant.content = `${assistant.content ?? ""}${delta.content}`;
				}
				if (delta.tool_calls?.length) {
					this.mergeToolCallDeltas(delta.tool_calls);
				}
			}
		}
	}

	/**
	 * A message the user sent while the agent worked, where the agent read it
	 * and tagged as it read it: what the agent writes next starts a new part
	 * after it.
	 */
	addUserMessage(content: string): void {
		this.currentAssistantIndex = null;
		this.parts.push({
			role: "user",
			content: formatFlowRunInboxMessage(content),
		});
	}

	/**
	 * Context the run attached for the model, kept byte for byte where the
	 * model read it: the next turn's history has to repeat it in place, or
	 * every request after it stops matching the cached prefix there.
	 */
	addSystemReminder(content: string): void {
		this.currentAssistantIndex = null;
		this.parts.push({ role: "user", content });
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
