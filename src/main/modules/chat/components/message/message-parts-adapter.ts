import type {
	AssistantExecutionPart,
	ComplexContentPartTool,
	MessageParts,
	ToolExecutionRecord,
} from "@/types/chat";
import type { ChatCompletionMessageToolCall } from "@/types/openai";
import type { AssistantContentPart } from "./AssistantContentFlow";

type ExecuteState = {
	node: string;
	metadata?: Record<string, unknown>;
};

const parseToolContent = (content: unknown): Record<string, unknown> | null => {
	if (typeof content !== "string") return null;
	try {
		const parsed = JSON.parse(content);
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
};

const stringifyToolContent = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (content == null) return "";
	return JSON.stringify(content, null, 2);
};

const getExecutionId = (event: ExecuteState): string =>
	(typeof event.metadata?.tool_call_id === "string" &&
		event.metadata.tool_call_id) ||
	(typeof event.metadata?.tool === "string" && event.metadata.tool) ||
	event.node;

const isToolExecution = (event: ExecuteState): boolean =>
	typeof event.metadata?.tool === "string" ||
	typeof event.metadata?.tool_call_id === "string";

const findToolCall = (
	toolCallsById: Map<string, ChatCompletionMessageToolCall>,
	toolCallId: string,
): ChatCompletionMessageToolCall | undefined => toolCallsById.get(toolCallId);

const buildToolPart = (
	toolCallId: string,
	content: unknown,
	toolCall: ChatCompletionMessageToolCall | undefined,
): ComplexContentPartTool => {
	const parsedContent = parseToolContent(content);
	const name =
		toolCall?.function.name ||
		(typeof parsedContent?.actionType === "string"
			? parsedContent.actionType
			: toolCallId);
	const description = stringifyToolContent(content);
	return {
		type: "tool",
		id: toolCallId,
		name,
		description,
		metadata: {
			tool: name,
			tool_call_id: toolCallId,
			...(toolCall ? { tool_call: toolCall } : {}),
			...(parsedContent ?? {}),
		},
		state:
			description.toLowerCase().startsWith("error") ||
			typeof parsedContent?.error === "string" ||
			parsedContent?.success === false
				? "error"
				: "complete",
	};
};

const buildRunningToolPart = (event: ExecuteState): ComplexContentPartTool => {
	const tool =
		typeof event.metadata?.tool === "string" ? event.metadata.tool : event.node;
	const toolCallId =
		typeof event.metadata?.tool_call_id === "string"
			? event.metadata.tool_call_id
			: getExecutionId(event);
	return {
		type: "tool",
		id: toolCallId,
		name: tool,
		description: "",
		metadata: {
			...(event.metadata ?? {}),
			tool,
			tool_call_id: toolCallId,
		},
		state: "running",
	};
};

const buildRunningExecutionPart = (
	event: ExecuteState,
): AssistantExecutionPart => ({
	type: "execution",
	id: getExecutionId(event),
	node: event.node,
	metadata: event.metadata,
	state: "running",
});

const buildPersistedToolPart = (
	record: ToolExecutionRecord,
): ComplexContentPartTool => ({
	type: "tool",
	id: record.id,
	name: record.name,
	description: record.outputPreview ?? record.error ?? "",
	metadata: {
		tool: record.name,
		tool_call_id: record.id,
		tool_call: {
			id: record.id,
			type: "function",
			function: {
				name: record.name,
				arguments: record.inputPreview ?? "",
			},
		},
		inputPreview: record.inputPreview,
		outputPreview: record.outputPreview,
		durationMs: record.durationMs,
		startedAt: record.startedAt,
		endedAt: record.endedAt,
		truncated: record.truncated,
		status: record.status,
		...(record.error ? { error: record.error } : {}),
	},
	state:
		record.status === "running"
			? "running"
			: record.status === "completed"
				? "complete"
				: "error",
});

export const buildAssistantContentParts = ({
	parts,
	executions,
	executeState,
	toolExecutions,
}: {
	parts: MessageParts | null | undefined;
	executions?: AssistantExecutionPart[];
	executeState?: ExecuteState;
	toolExecutions?: ToolExecutionRecord[];
}): AssistantContentPart[] => {
	const hasExecutionRecords = Boolean(toolExecutions?.length);
	const contentParts: AssistantContentPart[] = [
		...(executions ?? []),
		...(toolExecutions ?? []).map(buildPersistedToolPart),
	];
	const toolCallsById = new Map<string, ChatCompletionMessageToolCall>();
	const completedToolCallIds = new Set<string>();

	for (const part of parts ?? []) {
		if (part.role === "assistant") {
			for (const toolCall of part.tool_calls ?? []) {
				toolCallsById.set(toolCall.id, toolCall);
			}
			if (typeof part.content === "string" && part.content.trim()) {
				contentParts.push({ type: "text", text: part.content });
			}
			continue;
		}

		if (part.role === "tool") {
			completedToolCallIds.add(part.tool_call_id);
			if (!hasExecutionRecords) {
				contentParts.push(
					buildToolPart(
						part.tool_call_id,
						part.content,
						findToolCall(toolCallsById, part.tool_call_id),
					),
				);
			}
		}
	}

	if (executeState) {
		if (isToolExecution(executeState) && !hasExecutionRecords) {
			const runningTool = buildRunningToolPart(executeState);
			if (!completedToolCallIds.has(runningTool.id)) {
				contentParts.push(runningTool);
			}
		} else {
			contentParts.push(buildRunningExecutionPart(executeState));
		}
	}

	return contentParts;
};

export const hasAssistantContentParts = (
	parts: AssistantContentPart[],
): boolean =>
	parts.some((part) => {
		if (part.type === "text") return part.text.trim().length > 0;
		return true;
	});
