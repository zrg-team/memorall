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

/**
 * An execution record carries timing and status; the tool message carries the
 * payload. Both are needed: the record's `outputPreview` is redacted and cut at
 * 4k, so a large result no longer parses as JSON, and every renderer that reads
 * the structured payload (web search, web read, filesystem, planner…) silently
 * degrades to a wall of raw text. So prefer the message content when it is
 * there, and let the record supply everything around it.
 */
const buildPersistedToolPart = (
	record: ToolExecutionRecord,
	content: unknown,
	toolCall: ChatCompletionMessageToolCall | undefined,
): ComplexContentPartTool => {
	const description =
		content === undefined
			? (record.outputPreview ?? record.error ?? "")
			: stringifyToolContent(content);
	const parsedContent = parseToolContent(description);

	return {
		type: "tool",
		id: record.id,
		name: record.name,
		description,
		metadata: {
			// The payload goes first so the record's bookkeeping stays authoritative
			// — a tool result that happens to carry `durationMs` must not overwrite
			// the measured one.
			...(parsedContent ?? {}),
			tool: record.name,
			tool_call_id: record.id,
			tool_call: toolCall ?? {
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
			...(record.toolMetadata ? { tool_metadata: record.toolMetadata } : {}),
			...(record.error ? { error: record.error } : {}),
		},
		state:
			record.status === "running"
				? "running"
				: record.status === "completed"
					? "complete"
					: "error",
	};
};

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
	const toolCallsById = new Map<string, ChatCompletionMessageToolCall>();
	const toolContentById = new Map<string, unknown>();
	const completedToolCallIds = new Set<string>();

	// Collect the tool calls and their results up front so an execution record
	// can be paired with the message it produced.
	for (const part of parts ?? []) {
		if (part.role === "assistant") {
			for (const toolCall of part.tool_calls ?? []) {
				toolCallsById.set(toolCall.id, toolCall);
			}
			continue;
		}
		if (part.role === "tool") {
			completedToolCallIds.add(part.tool_call_id);
			toolContentById.set(part.tool_call_id, part.content);
		}
	}

	const recordsById = new Map(
		(toolExecutions ?? []).map((record) => [record.id, record]),
	);
	const placedRecordIds = new Set<string>();
	const contentParts: AssistantContentPart[] = [...(executions ?? [])];
	const pushRecord = (record: ToolExecutionRecord) => {
		placedRecordIds.add(record.id);
		contentParts.push(
			buildPersistedToolPart(
				record,
				toolContentById.get(record.id),
				findToolCall(toolCallsById, record.id),
			),
		);
	};

	// Walk the parts in the order they happened, so each tool card lands after
	// the text that announced it and before the text that followed its result.
	// A "block" is one assistant part plus the tool messages answering it.
	let blockToolCallIds: string[] = [];
	let blockHasTools = false;
	// Where tools whose call cannot be located go: the end of the latest block
	// that used tools.
	let lastToolBlockEnd = -1;
	const closeBlock = () => {
		// A tool that is still running has a record but no tool message yet.
		for (const id of blockToolCallIds) {
			const record = recordsById.get(id);
			if (record && !placedRecordIds.has(id)) pushRecord(record);
		}
		if (blockHasTools || blockToolCallIds.length > 0) {
			lastToolBlockEnd = contentParts.length;
		}
		blockToolCallIds = [];
		blockHasTools = false;
	};

	for (const part of parts ?? []) {
		if (part.role === "assistant") {
			closeBlock();
			if (typeof part.content === "string" && part.content.trim()) {
				contentParts.push({ type: "text", text: part.content });
			}
			blockToolCallIds = (part.tool_calls ?? []).map((call) => call.id);
			continue;
		}

		if (part.role !== "tool") continue;
		blockHasTools = true;
		const record = recordsById.get(part.tool_call_id);
		if (record) {
			if (!placedRecordIds.has(record.id)) pushRecord(record);
			continue;
		}
		// A tool message with no execution record — an older conversation, or a
		// result the stream never reported — still gets its own card.
		contentParts.push(
			buildToolPart(
				part.tool_call_id,
				part.content,
				findToolCall(toolCallsById, part.tool_call_id),
			),
		);
	}
	closeBlock();

	// Records no part accounts for: a running call whose id the stream never
	// matched (the provider sent none, so the two sides minted different ones),
	// or an older message that kept only its final answer. They belong after the
	// latest tool block, or ahead of the answer when there is no block at all.
	const unplaced = (toolExecutions ?? [])
		.filter((record) => !placedRecordIds.has(record.id))
		.map((record) =>
			buildPersistedToolPart(
				record,
				toolContentById.get(record.id),
				findToolCall(toolCallsById, record.id),
			),
		);
	if (unplaced.length > 0) {
		const lastTextIndex = contentParts.findLastIndex(
			(part) => part.type === "text",
		);
		const insertAt =
			lastToolBlockEnd >= 0
				? lastToolBlockEnd
				: lastTextIndex >= 0
					? lastTextIndex
					: contentParts.length;
		contentParts.splice(insertAt, 0, ...unplaced);
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
