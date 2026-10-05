import {
	createFlowRunInbox,
	FLOW_RUN_INBOX_RUNTIME_KEY,
	type FlowRunInbox,
	type FlowRunInboxMessage,
} from "@memorall/agent-harness-flows/context/run-inbox";
import type { FoundationState } from "@memorall/agent-harness-flows/graph/foundation/state";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	SYSTEM_REMINDER_EVENT,
	systemReminderMessage,
} from "@memorall/agent-harness-flows/graph/system-reminders";
import { ITERATION_LIMIT_EVENT } from "@memorall/agent-harness-flows/limits";
import {
	buildDefaultFlowConfig,
	mergeWithDefaultConfig,
} from "@memorall/agent-harness-flows/utils/flow-config";
import {
	type FlowAction,
	isCustomChunkPayload,
	normalizeLangGraphStreamChunk,
} from "@memorall/agent-harness-flows/utils/langgraph-stream";
import { eq, sql } from "drizzle-orm";
import { platform } from "@/platform/current";
import { serviceManager } from "@/services";
import {
	createMemorallFlowRun,
	type MemorallFlowServices,
	toLegacyFlowStream,
} from "@/services/agent-harness";
import {
	hasReplyParts,
	MessagePartsAccumulator,
	resolveMessageParts,
	withReplyText,
} from "@/services/chat/message-parts";
import {
	accumulateChunkToolCalls,
	createToolCallAccumulator,
	type ToolCallAccumulator,
} from "@/services/chat/tool-call-accumulator";
import {
	createToolExecutionPreview,
	finishRunningToolExecutions,
	upsertToolExecution,
} from "@/services/chat/tool-executions";
import {
	getValidRecallTypes,
	isRecallTypeValidForGrow,
	type RecallType,
} from "@/services/database/entities/topic-types";
import { documentFileSystemService as fsService } from "@/services/filesystem/document-filesystem";
import {
	consoleFlowLogger,
	toAgentSandbox,
	toFlowDatabase,
	toFlowEmbedding,
	toFlowFileSystem,
	toFlowLLM,
	toFlowMcpStdio,
	toFlowSandbox,
	toFlowWebBrowser,
	withPromptCacheKey,
	withReasoningEffort,
} from "@/services/flow-service-adapters";
import {
	reasoningEffortKey,
	reasoningEffortSettings,
} from "@/services/llm/reasoning-effort-settings";
import {
	AGENT_RUNTIME_KEY,
	CONVERSATION_RUNTIME_KEY,
	RUN_RUNTIME_KEY,
} from "@/services/chat/runtime-keys";
import { applyMemonAbsorption } from "@/services/memon/feature-config";
import {
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";
import {
	type AggregatedTokenUsage,
	addTokenUsage,
	createAggregatedTokenUsage,
	extractChunkOutputText,
	resolveTokenUsage,
} from "@/services/llm/utils/token-usage";
import { withResolvedConnections } from "@/services/mcp-connections";
import type {
	AssistantExecutionPart,
	ChatCompaction,
	ComplexContent,
	ConversationContext,
	MessageParts,
	ToolExecutionRecord,
} from "@/types/chat";
import type {
	ChatCompletionChunk,
	ChatCompletionChunkToolCall,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionRequest,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
	ChatCompletionUsage,
	ChatMessage,
	ReasoningEffort,
} from "@/types/openai";
import { ABORT_ERROR_MESSAGE, isAbortError } from "@/utils/abort";
import { isUuid } from "@/utils/uuid";
import {
	createReplyCheckpointer,
	persistReplyWithFallback,
} from "./chat-message-persistence";
import {
	sanitizeForJson,
	stripNulCharacters,
	stripNulDeep,
} from "@/utils/sanitize-json";
import { BaseProcessHandler } from "./base-process-handler";
import {
	createJobErrorMetadata,
	getErrorMessage,
	type JobErrorMetadata,
} from "./error-metadata";
import { handlerRegistry } from "./handler-registry";
import {
	ChunkDispatcher,
	StreamBuffer,
	type StreamedDelta,
} from "./stream-buffer";
import type {
	BaseJob,
	ItemHandlerResult,
	JobProgressUpdate,
	ProcessDependencies,
} from "./types";

export { ChunkDispatcher, StreamBuffer } from "./stream-buffer";

export interface ChatStreamConfig {
	/**
	 * Minimum number of words to buffer before streaming (default: 1).
	 *
	 * This used to be 5, back when every emission was its own message across the
	 * context boundary and buffering was the only thing keeping that volume
	 * down. Word-based buffering ties latency to how fast the model happens to
	 * be — at 20 tokens/s, five words is roughly a third of a second of nothing,
	 * then a jump. `ChunkDispatcher` now bounds the message rate by time
	 * instead, which is constant, so the buffer no longer has to.
	 */
	minWordsToStream?: number;
	/** Whether to stream tool calls immediately (default: true) */
	streamToolCallsImmediately?: boolean;
}

export interface ChatPayload {
	messages: ChatMessage[];
	model: string;
	mode: "normal" | "agent" | "custom";
	topicId?: string; // For topic filtering in custom mode
	agentFlowId?: string;
	flowConfig?: UnifiedFlowConfig;
	flowConfigPrefix?: UnifiedFlowConfig;
	streamConfig?: ChatStreamConfig;
	tools?: ChatCompletionTool[];
	tool_choice?: ChatCompletionToolChoiceOption;
	parallel_tool_calls?: boolean;
	conversation?: ConversationContext;
	/**
	 * Context that changes from one message to the next — the page the user is
	 * on, what they pointed at. Attached once, right after the newest message,
	 * and kept there in the stored reply, rather than written into the system
	 * prompt, where it would invalidate the cached prefix of everything behind
	 * it.
	 */
	reminders?: string[];
}

export interface StopChatPayload {
	/** The `chat` job whose run should end. */
	targetJobId: string;
}

export interface InjectChatMessagePayload {
	/** The `chat` job the user wrote to while it ran. */
	targetJobId: string;
	/** Read by the agent before its next request. */
	message: FlowRunInboxMessage;
}

export type ChatResult =
	| {
			type: "chunk";
			chunk?: ChatCompletionChunk;
	  }
	| {
			type: "execute-start";
			node: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "tool-execution";
			execution: ToolExecutionRecord;
	  }
	| {
			/** The conversation was compacted before the next request. */
			type: "compaction";
			compaction: ChatCompaction;
	  }
	| {
			/** The agent read a message the user sent while it worked. */
			type: "user-message";
			id: string;
			content: string;
	  }
	| {
			/**
			 * Context the run attached for the model, as it was sent. Kept in the
			 * reply where it was read, never shown as anything the user wrote.
			 */
			type: "system-reminder";
			content: string;
	  }
	| {
			/** What the reply has used so far, after each model request. */
			type: "usage";
			usage: Omit<AggregatedTokenUsage, "calls">;
	  }
	| {
			type: "final";
			content: string;
			parts?: MessageParts;
			metadata?: {
				actions?: Array<{
					id: string;
					name: string;
					description: string;
					metadata: Record<string, unknown>;
				}>;
				executions?: AssistantExecutionPart[];
				toolExecutions?: ToolExecutionRecord[];
				compactions?: ChatCompaction[];
				tool_calls?: ChatCompletionMessageToolCall[];
				usage?: AggregatedTokenUsage;
				model?: string;
				provider?: string;
				timeToAnswer?: number;
				tokensPerSecond?: number;
				estimatedTokens?: number;
				agentFlowName?: string;
				error?: JobErrorMetadata;
				/** The user stopped the run; this is what it had done by then. */
				stopped?: boolean;
				/**
				 * The run reached its iteration limit (this many turns) with tool
				 * calls still to make: cut off, not finished, and can be continued.
				 */
				iterationLimit?: number;
			};
	  }
	| {
			type: "action";
			actions?: Array<{
				id: string;
				name: string;
				description: string;
				metadata: Record<string, unknown>;
			}>;
	  };

// Upper bound on how often streamed content crosses the offscreen -> UI
// boundary. Each crossing is a structured clone plus an IPC hop, and a fast
// model produces content far faster than a 60fps UI can show it; ~25 updates a
// second is smooth and costs a fraction of one-per-buffered-fragment.
const CHUNK_DISPATCH_INTERVAL_MS = 40;

const JOB_NAMES = {
	chat: "chat",
	stopChat: "stop-chat",
	injectChatMessage: "inject-chat-message",
} as const;

/** How long a stop that arrived before its run is remembered. */
const STOP_MEMORY_MS = 60_000;

/** How long a stopped run waits for its cut-off requests to wind down. */
const STOP_SETTLE_MS = 1_000;

export type ChatJob = BaseJob & {
	jobType: typeof JOB_NAMES.chat;
	payload: ChatPayload;
};

type StopChatJob = BaseJob & {
	jobType: typeof JOB_NAMES.stopChat;
	payload: StopChatPayload;
};

type InjectChatMessageJob = BaseJob & {
	jobType: typeof JOB_NAMES.injectChatMessage;
	payload: InjectChatMessagePayload;
};

type TokenUsage = ChatCompletionUsage;

const createStopError = () =>
	new DOMException(ABORT_ERROR_MESSAGE, "AbortError");

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
	typeof value === "object" && value !== null && Symbol.asyncIterator in value;

/**
 * Every model request of one run, bound to the run's stop signal.
 *
 * Stop has to end the request in flight, not just the loop around it, and it
 * must not cost the run its token count. Providers report usage on the last
 * chunk, so a request cut short never reports any even though it was billed;
 * when that happens an estimate is booked for what it read and wrote, the same
 * estimate a provider without usage reporting gets.
 */
const createStoppableRequests = (
	signal: AbortSignal,
	addUsage: (usage: TokenUsage) => void,
) => {
	const inFlight = new Set<Promise<void>>();

	async function* track(
		stream: AsyncIterable<ChatCompletionChunk>,
		messages: ChatCompletionMessageParam[],
	): AsyncGenerator<ChatCompletionChunk, void, undefined> {
		if (signal.aborted) throw createStopError();
		let settle!: () => void;
		const settled = new Promise<void>((resolve) => {
			settle = resolve;
		});
		inFlight.add(settled);
		let output = "";
		let reportedUsage = false;
		try {
			for await (const chunk of stream) {
				if (chunk.usage) reportedUsage = true;
				output += extractChunkOutputText(chunk);
				yield chunk;
				if (signal.aborted) throw createStopError();
			}
		} finally {
			if (signal.aborted && !reportedUsage) {
				addUsage(resolveTokenUsage(undefined, messages, output));
			}
			inFlight.delete(settled);
			settle();
		}
	}

	const request = (
		send: (body: ChatCompletionRequest) => unknown,
		body: ChatCompletionRequest,
	) => {
		const result = send({
			...body,
			signal: body.signal ? AbortSignal.any([body.signal, signal]) : signal,
		});
		return isAsyncIterable<ChatCompletionChunk>(result)
			? track(result, body.messages)
			: result;
	};

	return {
		track,
		/** The run's LLM, with every request stoppable and accounted for. */
		bind: (llm: FlowServices["llm"]): FlowServices["llm"] => {
			const send = (body: ChatCompletionRequest) =>
				request((next) => llm.chatCompletions(next), body);
			return {
				...llm,
				chat: {
					completions: {
						create: send as NonNullable<
							FlowServices["llm"]["chat"]
						>["completions"]["create"],
					},
				},
				chatCompletions: send as FlowServices["llm"]["chatCompletions"],
			};
		},
		/** Wait, briefly, for cut-off requests to book their usage. */
		settle: async () => {
			if (inFlight.size === 0) return;
			await Promise.race([
				Promise.allSettled([...inFlight]),
				new Promise((resolve) => setTimeout(resolve, STOP_SETTLE_MS)),
			]);
		},
	};
};

type StoppableRequests = ReturnType<typeof createStoppableRequests>;

/** What every LLM request of one run carries. */
interface RunRequestDefaults {
	promptCacheKey?: string;
	reasoningEffort?: ReasoningEffort;
}

const RECALL_STEP_BY_TYPE: Record<RecallType, string> = {
	smart: "context-smart-retrieve",
	quick: "context-quick-retrieve",
	llm: "context-llm-retrieve",
	structmem: "structmem-retrieve",
};

const RETRIEVAL_STEP_NAMES = new Set(Object.values(RECALL_STEP_BY_TYPE));

function applyTopicRecallType(
	config: UnifiedFlowConfig,
	recallType: RecallType | undefined,
): UnifiedFlowConfig {
	if (!recallType) return config;

	const selectedStepName = RECALL_STEP_BY_TYPE[recallType];
	return {
		...config,
		steps: config.steps.map((step) =>
			RETRIEVAL_STEP_NAMES.has(step.name)
				? { ...step, enabled: step.name === selectedStepName }
				: step,
		),
	};
}

function applyFlowConfigPrefix(
	base: UnifiedFlowConfig,
	prefix: UnifiedFlowConfig | undefined,
): UnifiedFlowConfig {
	const prefixSteps = prefix?.steps?.filter((step) => step.enabled) ?? [];
	if (prefixSteps.length === 0) return base;

	const prefixStepIds = new Set(prefixSteps.map((step) => step.id));
	return {
		...base,
		steps: [
			...prefixSteps,
			...base.steps.filter((step) => !prefixStepIds.has(step.id)),
		],
	};
}

const hasThreadHistory = (
	conversation: ConversationContext | undefined,
): conversation is ConversationContext & {
	historyBoundary: NonNullable<ConversationContext["historyBoundary"]>;
} => Boolean(conversation?.historyBoundary?.separatorId);

/**
 * The prompt-cache routing key for a conversation.
 *
 * Every turn of a thread shares its prompt prefix, so every turn should land
 * on the provider machine that already holds that prefix. The conversation id
 * is the one value that is identical across all of them; without a saved
 * conversation the adapter derives a key from the messages instead.
 */
const getPromptCacheKey = (
	conversation: ConversationContext | undefined,
): string | undefined =>
	conversation?.id ? `memorall:conversation:${conversation.id}` : undefined;

const getThreadHistoryRuntimeVars = (
	conversation: ConversationContext | undefined,
): Record<string, unknown> | undefined =>
	hasThreadHistory(conversation)
		? {
				[THREAD_HISTORY_CONVERSATION_RUNTIME_KEY]: conversation.id,
				[THREAD_HISTORY_SEPARATOR_RUNTIME_KEY]:
					conversation.historyBoundary.separatorId,
			}
		: undefined;

/**
 * Runtime vars for every flow run: conversation scope first, then history,
 * then the inbox the user writes to while the run goes on.
 */
const getChatRuntimeVars = (
	conversation: ConversationContext | undefined,
	runId: string,
	agentFlowId: string | undefined,
	inbox: FlowRunInbox,
): Record<string, unknown> => ({
	...(conversation?.id ? { [CONVERSATION_RUNTIME_KEY]: conversation.id } : {}),
	[RUN_RUNTIME_KEY]: runId,
	...(agentFlowId ? { [AGENT_RUNTIME_KEY]: agentFlowId } : {}),
	...getThreadHistoryRuntimeVars(conversation),
	[FLOW_RUN_INBOX_RUNTIME_KEY]: inbox,
});

type FlowStreamDeps = {
	jobId: string;
	model: string;
	config: Required<ChatStreamConfig>;
	dependencies: ProcessDependencies;
	dispatcher: ChunkDispatcher;
	streamBuffer: StreamBuffer;
	getProgress: () => number;
	onChunk?: (chunk: ChatCompletionChunk) => void;
	onUsage?: (usage: TokenUsage) => void;
	onToolCalls?: (toolCalls: ChatCompletionChunkToolCall[] | undefined) => void;
};

type StreamBufferDeps = {
	jobId: string;
	model: string;
	config: Required<ChatStreamConfig>;
	dependencies: ProcessDependencies;
	dispatcher: ChunkDispatcher;
	onContent: (content: string) => void;
	getProgress: () => number;
};

type FlowCustomPayloadDeps = {
	payload: unknown;
	dispatcher: ChunkDispatcher;
	handleChunk: (chunk: ChatCompletionChunk) => Promise<void>;
	handleActions: (actions: FlowAction[]) => void;
	handleExecutionStart: (event: {
		node: string;
		metadata?: Record<string, unknown>;
	}) => void;
	handleToolExecution: (
		phase: "start" | "result",
		event: { node: string; metadata?: Record<string, unknown> },
	) => ToolExecutionRecord | undefined;
	/** A compaction the flow reported; returns it as the reply keeps it. */
	handleCompaction: (
		report: Record<string, unknown> | undefined,
	) => ChatCompaction | undefined;
	/** The agent read a message the user sent while it worked. */
	handleUserMessage: (message: FlowRunInboxMessage) => void;
	/** The run attached reminders to the conversation. */
	handleSystemReminder: (content: string) => void;
	/** The run reached its iteration limit with work left. */
	handleIterationLimit: (maxIterations: number) => void;
	dependencies: ProcessDependencies;
	jobId: string;
	executeStage: string;
};

type FlowServices = MemorallFlowServices;

type FlowRuntimeDeps = {
	jobId: string;
	model: string;
	config: Required<ChatStreamConfig>;
	dependencies: ProcessDependencies;
	dispatcher: ChunkDispatcher;
	streamBuffer: StreamBuffer;
	actions: FlowAction[];
	messagePartsAccumulator: MessagePartsAccumulator;
	toolCallAccumulator: ToolCallAccumulator;
	addUsage: (usage: TokenUsage) => void;
	getProgress: () => number;
};

type FlowStreamRunDeps = FlowRuntimeDeps & {
	stream: AsyncIterable<unknown>;
	executeStage: string;
	handleExecutionStart: (event: {
		node: string;
		metadata?: Record<string, unknown>;
	}) => void;
	handleToolExecution: FlowCustomPayloadDeps["handleToolExecution"];
	handleCompaction: FlowCustomPayloadDeps["handleCompaction"];
	handleUserMessage: FlowCustomPayloadDeps["handleUserMessage"];
	handleSystemReminder: FlowCustomPayloadDeps["handleSystemReminder"];
	handleIterationLimit: FlowCustomPayloadDeps["handleIterationLimit"];
};

type AssistantMessageFinalization = {
	conversation?: ConversationContext;
	content: string;
	model: string;
	provider: string;
	startTime: number;
	usage?: AggregatedTokenUsage;
	actions: ChatResultFinalAction[];
	executions: AssistantExecutionPart[];
	toolExecutions: ToolExecutionRecord[];
	compactions?: ChatCompaction[];
	error?: JobErrorMetadata;
	stopped?: boolean;
	iterationLimit?: number;
};

type AssistantMessagePersistence = {
	conversation: ConversationContext;
	content: string;
	complexContent: ComplexContent | null;
	parts: MessageParts | null;
	metadata: AssistantMessageMetadata;
};

type AssistantMessageMetadata = {
	model: string;
	provider: string;
	timeToAnswer: number;
	tokensPerSecond: number;
	estimatedTokens: number;
	actions?: ChatResultFinalAction[];
	executions?: AssistantExecutionPart[];
	toolExecutions?: ToolExecutionRecord[];
	/** Where the conversation was compacted during this reply. */
	compactions?: ChatCompaction[];
	usage?: AggregatedTokenUsage;
	agentFlowName?: string;
	error?: JobErrorMetadata;
	stopped?: boolean;
	/** The run reached its iteration limit (this many turns) with work left. */
	iterationLimit?: number;
	/** Saved mid-run: the run may still be going, or may have been cut off. */
	incomplete?: boolean;
};

/** What is left of the metadata when only the reply's text can be kept. */
const minimalReplyMetadata = ({
	actions: _actions,
	executions: _executions,
	toolExecutions: _toolExecutions,
	...rest
}: AssistantMessageMetadata): AssistantMessageMetadata => rest;

type ChatResultFinalAction = NonNullable<
	NonNullable<Extract<ChatResult, { type: "final" }>["metadata"]>["actions"]
>[number];

const normalizeActions = (actions: FlowAction[]): ChatResultFinalAction[] =>
	actions.map((action) => ({
		id: action.id,
		name: action.name,
		description: action.description ?? "",
		metadata: action.metadata,
	}));

const getExecutionPartId = (event: {
	node: string;
	metadata?: Record<string, unknown>;
}): string =>
	(typeof event.metadata?.tool_call_id === "string" &&
		event.metadata.tool_call_id) ||
	(typeof event.metadata?.tool === "string" && event.metadata.tool) ||
	event.node;

const isToolExecution = (event: {
	metadata?: Record<string, unknown>;
}): boolean =>
	typeof event.metadata?.tool === "string" ||
	typeof event.metadata?.tool_call_id === "string";

const addExecutionPart = (
	parts: AssistantExecutionPart[],
	event: { node: string; metadata?: Record<string, unknown> },
): AssistantExecutionPart[] => {
	if (isToolExecution(event)) return parts;

	const completed = parts.map((part) =>
		part.state === "running" ? { ...part, state: "complete" as const } : part,
	);
	const id = getExecutionPartId(event);
	const next: AssistantExecutionPart = {
		type: "execution",
		id,
		node: event.node,
		metadata: event.metadata,
		state: "running",
	};
	const existingIndex = completed.findIndex((part) => part.id === id);
	if (existingIndex === -1) return [...completed, next];
	const copy = [...completed];
	copy[existingIndex] = next;
	return copy;
};

const completeExecutionParts = (
	parts: AssistantExecutionPart[],
): AssistantExecutionPart[] =>
	parts.map((part) =>
		part.state === "running" ? { ...part, state: "complete" as const } : part,
	);

/** Loaded on first use: most runs have no skills enabled. */
const loadSkillFileSystem = () =>
	import("@/services/filesystem/skill-filesystem");

export class ChatHandler extends BaseProcessHandler<ChatJob | StopChatJob> {
	constructor() {
		super();
	}

	/**
	 * The reply as it is stored: its parts when they hold it, its text when
	 * they do not. Parts that are only reminders keep the text beside them
	 * rather than replacing it with nothing.
	 */
	private static storedReplyBody = (
		parts: MessageParts,
		content: string,
	): Pick<AssistantMessagePersistence, "content" | "parts"> => {
		const stored = withReplyText(parts, content);
		return {
			content: hasReplyParts(stored) ? "" : content,
			parts: stored.length > 0 ? stored : null,
		};
	};

	private static persistAssistantMessage = ({
		conversation,
		content,
		complexContent,
		parts,
		metadata,
	}: AssistantMessagePersistence) =>
		serviceManager.databaseService.use(async ({ db, schema }) => {
			const [existing] = await db
				.select()
				.from(schema.messages)
				.where(eq(schema.messages.id, conversation.inProgressMessage.id))
				.limit(1);

			if (!existing) {
				return;
			}

			await db
				.update(schema.messages)
				.set({
					// A tool result can carry a file's raw bytes; one NUL among them
					// fails the write and loses the reply.
					content: stripNulCharacters(content),
					complexContent: stripNulDeep(complexContent),
					parts: stripNulDeep(parts),
					metadata: sanitizeForJson({
						...(typeof existing.metadata === "object" &&
						existing.metadata !== null
							? existing.metadata
							: {}),
						...metadata,
					}) as Record<string, unknown>,
					updatedAt: new Date(),
				})
				.where(eq(schema.messages.id, conversation.inProgressMessage.id));
		});

	private static buildAssistantMessageMetadata({
		conversation,
		content,
		model,
		provider,
		startTime,
		usage,
		actions,
		executions,
		toolExecutions,
		compactions,
		error,
		stopped,
		iterationLimit,
	}: AssistantMessageFinalization): AssistantMessageMetadata {
		const timeToAnswer = (Date.now() - startTime) / 1000;
		const outputTokens =
			usage?.completion_tokens ?? Math.round(content.length / 4);
		const totalTokens = usage?.total_tokens ?? Math.round(content.length / 4);

		return {
			model,
			provider,
			timeToAnswer,
			tokensPerSecond: timeToAnswer > 0 ? outputTokens / timeToAnswer : 0,
			estimatedTokens: totalTokens,
			...(actions.length > 0 ? { actions } : {}),
			...(executions.length > 0 ? { executions } : {}),
			...(toolExecutions.length > 0 ? { toolExecutions } : {}),
			...(compactions?.length ? { compactions } : {}),
			...(conversation?.agentFlowName
				? { agentFlowName: conversation.agentFlowName }
				: {}),
			...(usage ? { usage } : {}),
			...(error ? { error } : {}),
			...(stopped ? { stopped } : {}),
			...(iterationLimit ? { iterationLimit } : {}),
		};
	}

	private static deltaChunkUpdate(
		model: string,
		delta: StreamedDelta,
		progress: number,
	): JobProgressUpdate {
		return {
			stage: "Receiving response...",
			progress,
			result: {
				type: "chunk",
				chunk: {
					id: `chunk-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [
						{
							index: 0,
							delta: { ...delta, role: "assistant" },
							finish_reason: null,
						},
					],
				},
			} as ChatResult,
		};
	}

	/**
	 * The dispatcher every streamed update for one job goes through.
	 *
	 * Content, reasoning and tool-call arguments are throttled and merged;
	 * anything else flushes them first and is sent straight away. One place
	 * decides the wire rate, so the word-buffer above it stays a readability knob
	 * rather than the thing that sets IPC volume.
	 */
	private static createChunkDispatcher(
		jobId: string,
		model: string,
		dependencies: ProcessDependencies,
		getProgress: () => number,
	): ChunkDispatcher {
		return new ChunkDispatcher({
			intervalMs: CHUNK_DISPATCH_INTERVAL_MS,
			sendDelta: (delta) =>
				dependencies.updateJobProgress(
					jobId,
					ChatHandler.deltaChunkUpdate(model, delta, getProgress()),
				),
		});
	}

	private static createStreamBuffer(deps: StreamBufferDeps): StreamBuffer {
		return new StreamBuffer(deps.config.minWordsToStream, (bufferedContent) => {
			deps.onContent(bufferedContent);
			deps.dispatcher.queueContent(bufferedContent);
		});
	}

	private static hasToolCalls(
		delta: ChatCompletionChunk["choices"][number]["delta"] | undefined,
	): boolean {
		return Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
	}

	private static createHandleChunk(deps: FlowStreamDeps) {
		// Providers differ on whether `role` appears once or on every delta.
		// When it repeats, the raw chunk used to be forwarded per token on top of
		// the buffered content — one extra cross-context message per token, for a
		// field the consumer already has. Announce it once and let the streamed
		// fragments flow through the dispatcher alone.
		let assistantRoleAnnounced = false;
		const sendNow = (chunk: ChatCompletionChunk) =>
			deps.dispatcher.send(() =>
				deps.dependencies.updateJobProgress(deps.jobId, {
					stage: "Receiving response...",
					progress: deps.getProgress(),
					result: { type: "chunk", chunk } as ChatResult,
				}),
			);

		return async (chunk: ChatCompletionChunk) => {
			deps.onChunk?.(chunk);

			if (chunk.usage) {
				deps.onUsage?.(chunk.usage);
			}

			const choice = chunk.choices?.[0];
			if (!choice) {
				return;
			}

			const delta = choice.delta;

			// A tool result is one whole message: it goes out as it is.
			if (delta?.role === "tool" || delta?.tool_call_id) {
				sendNow(chunk);
				return;
			}

			if (delta?.reasoning) {
				deps.dispatcher.queueReasoning(delta.reasoning);
			}
			if (delta?.content) {
				deps.streamBuffer.add(delta.content);
			}
			if (
				deps.config.streamToolCallsImmediately &&
				ChatHandler.hasToolCalls(delta)
			) {
				deps.onToolCalls?.(delta.tool_calls);
				// Text the buffer still holds was written before this call.
				deps.streamBuffer.flush();
				deps.dispatcher.queueToolCalls(delta.tool_calls ?? []);
			}

			const isNewRoleAnnouncement =
				delta?.role === "assistant" && !assistantRoleAnnounced;
			if (isNewRoleAnnouncement) {
				assistantRoleAnnounced = true;
			}
			if (!choice.finish_reason && !isNewRoleAnnouncement) {
				return;
			}

			// The fragments are queued above; this carries only the structure.
			sendNow({
				...chunk,
				choices: [{ ...choice, delta: { role: delta?.role } }],
			});
		};
	}

	private static createFlowHandleActions(
		dependencies: ProcessDependencies,
		dispatcher: ChunkDispatcher,
		jobId: string,
		actions: FlowAction[],
	) {
		return (next: FlowAction[]) => {
			let added = false;
			for (const action of next) {
				if (!actions.find((a) => a.id === action.id)) {
					actions.push(action);
					added = true;
				}
			}
			if (added) {
				dispatcher.send(() =>
					dependencies.updateJobProgress(jobId, {
						stage: "Receiving response...",
						progress: 10,
						result: {
							type: "action",
							actions,
						} as ChatResult,
					}),
				);
			}
		};
	}

	/**
	 * The run's LLM, with what every one of its requests carries: the cache key
	 * that routes all turns of one conversation to the same prompt cache, and
	 * the reasoning effort the user chose for the model.
	 */
	private static getRunLLM({
		promptCacheKey,
		reasoningEffort,
	}: RunRequestDefaults): FlowServices["llm"] {
		let llm = toFlowLLM(serviceManager.llmService);
		if (promptCacheKey) llm = withPromptCacheKey(llm, promptCacheKey);
		if (reasoningEffort) llm = withReasoningEffort(llm, reasoningEffort);
		return llm;
	}

	/**
	 * @param requestDefaults stamped on every LLM request of the run.
	 * @param requests binds every LLM request of the run to its stop signal.
	 */
	private static getFlowServices(
		requestDefaults: RunRequestDefaults,
		requests: StoppableRequests,
	): FlowServices {
		const sandboxService = serviceManager.getSandboxContainerService();
		const fileSystem = toFlowFileSystem(fsService);
		return {
			llm: requests.bind(ChatHandler.getRunLLM(requestDefaults)),
			embedding: toFlowEmbedding(serviceManager.embeddingService),
			database: toFlowDatabase(serviceManager.databaseService),
			logger: consoleFlowLogger,
			sandboxContainer: toFlowSandbox(sandboxService),
			sandboxRuntime: toAgentSandbox(sandboxService, fileSystem),
			webBrowser: toFlowWebBrowser(serviceManager.getWebBrowserService()),
			mcpStdio: toFlowMcpStdio(platform.mcpStdio),
			fs: fileSystem,
			// The agent's enabled skills (add-skill-context) and load_skill.
			skillService: {
				list: async () =>
					(await loadSkillFileSystem()).skillFileSystemService.listSkills(),
				load: async (name) =>
					(await loadSkillFileSystem()).skillFileSystemService.readSkill(name),
			},
		};
	}

	private static createFlowRuntime({
		jobId,
		model,
		config,
		dependencies,
		dispatcher,
		streamBuffer,
		actions,
		messagePartsAccumulator,
		toolCallAccumulator,
		addUsage,
		getProgress,
	}: FlowRuntimeDeps) {
		return {
			handleChunk: ChatHandler.createHandleChunk({
				jobId,
				model,
				config,
				dependencies,
				dispatcher,
				streamBuffer,
				getProgress,
				onChunk: (chunk) => messagePartsAccumulator.addChunk(chunk),
				onUsage: addUsage,
				onToolCalls: (toolCalls) =>
					accumulateChunkToolCalls(toolCallAccumulator, toolCalls),
			}),
			handleActions: ChatHandler.createFlowHandleActions(
				dependencies,
				dispatcher,
				jobId,
				actions,
			),
		};
	}

	private static async runFlowStream({
		stream,
		executeStage,
		handleExecutionStart,
		handleToolExecution,
		handleCompaction,
		handleUserMessage,
		handleSystemReminder,
		handleIterationLimit,
		...runtimeDeps
	}: FlowStreamRunDeps): Promise<Record<string, unknown> | null> {
		const { handleChunk, handleActions } =
			ChatHandler.createFlowRuntime(runtimeDeps);

		let finalState: Record<string, unknown> | null = null;
		for await (const partial of stream) {
			const { mode, payload } = normalizeLangGraphStreamChunk(partial);

			if (mode === "custom") {
				await ChatHandler.handleFlowCustomPayload({
					payload,
					dispatcher: runtimeDeps.dispatcher,
					handleChunk,
					handleActions,
					handleExecutionStart,
					handleToolExecution,
					handleCompaction,
					handleUserMessage,
					handleSystemReminder,
					handleIterationLimit,
					dependencies: runtimeDeps.dependencies,
					jobId: runtimeDeps.jobId,
					executeStage,
				});
				continue;
			}

			if (mode === "values") {
				finalState = payload as Record<string, unknown>;
			}
		}

		return finalState;
	}

	private static async handleFlowCustomPayload({
		payload,
		dispatcher,
		handleChunk,
		handleActions,
		handleExecutionStart,
		handleToolExecution,
		handleCompaction,
		handleUserMessage,
		handleSystemReminder,
		handleIterationLimit,
		dependencies,
		jobId,
		executeStage,
	}: FlowCustomPayloadDeps): Promise<void> {
		if (!isCustomChunkPayload(payload)) {
			return;
		}

		switch (payload.type) {
			case "llm":
				if ("chunk" in payload) {
					await handleChunk(payload.chunk as ChatCompletionChunk);
				}
				return;
			case "actions":
				if ("actions" in payload) {
					handleActions(payload.actions as FlowAction[]);
				}
				return;
			case "execute-start":
				if ("node" in payload) {
					const event = {
						node: payload.node,
						metadata: payload.metadata,
					};
					handleExecutionStart(event);
					const execution = handleToolExecution("start", event);
					dispatcher.send(() =>
						dependencies.updateJobProgress(jobId, {
							stage: executeStage,
							progress: 12,
							result: {
								type: "execute-start",
								node: event.node,
								metadata: event.metadata,
							} as ChatResult,
						}),
					);
					if (execution) {
						dispatcher.send(() =>
							dependencies.updateJobProgress(jobId, {
								stage: executeStage,
								progress: 12,
								result: { type: "tool-execution", execution } as ChatResult,
							}),
						);
					}
				}
				return;
			case "tool-result":
				if ("node" in payload) {
					const event = {
						node: payload.node as string,
						metadata:
							"metadata" in payload
								? (payload.metadata as Record<string, unknown> | undefined)
								: undefined,
					};
					const execution = handleToolExecution("result", event);
					if (execution) {
						dispatcher.send(() =>
							dependencies.updateJobProgress(jobId, {
								stage: executeStage,
								progress: 14,
								result: { type: "tool-execution", execution } as ChatResult,
							}),
						);
					}
				}
				return;
			case "compact": {
				const compaction = handleCompaction(
					"metadata" in payload &&
						payload.metadata &&
						typeof payload.metadata === "object"
						? (payload.metadata as unknown as Record<string, unknown>)
						: undefined,
				);
				if (compaction) {
					dispatcher.send(() =>
						dependencies.updateJobProgress(jobId, {
							stage: executeStage,
							progress: 14,
							result: { type: "compaction", compaction } as ChatResult,
						}),
					);
				}
				return;
			}
			case "user-message": {
				const message = payload as unknown as Partial<FlowRunInboxMessage>;
				if (
					typeof message.id !== "string" ||
					typeof message.content !== "string"
				) {
					return;
				}
				const read = { id: message.id, content: message.content };
				handleUserMessage(read);
				dispatcher.send(() =>
					dependencies.updateJobProgress(jobId, {
						stage: executeStage,
						progress: 14,
						result: { type: "user-message", ...read } as ChatResult,
					}),
				);
				return;
			}
			case SYSTEM_REMINDER_EVENT: {
				const content =
					"content" in payload && typeof payload.content === "string"
						? payload.content
						: "";
				if (!content) return;
				handleSystemReminder(content);
				dispatcher.send(() =>
					dependencies.updateJobProgress(jobId, {
						stage: executeStage,
						progress: 14,
						result: { type: "system-reminder", content } as ChatResult,
					}),
				);
				return;
			}
			case ITERATION_LIMIT_EVENT:
				if (
					"maxIterations" in payload &&
					typeof payload.maxIterations === "number"
				) {
					handleIterationLimit(payload.maxIterations);
				}
				return;
			default:
				return;
		}
	}

	private static async streamChatCompletions(
		stream: AsyncIterableIterator<ChatCompletionChunk>,
		handleChunk: (chunk: ChatCompletionChunk) => Promise<void>,
	) {
		for await (const chunk of stream) {
			await handleChunk(chunk);
		}
	}

	/** The stop switch of every run in flight, by job id. */
	private readonly runStops = new Map<string, AbortController>();
	/** Stops that arrived before their run did. */
	private readonly stoppedBeforeStart = new Set<string>();
	/** What the user wrote to each run in flight, by job id. */
	private readonly runInboxes = new Map<string, FlowRunInbox>();

	async process(
		jobId: string,
		job: ChatJob | StopChatJob | InjectChatMessageJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		if (job.jobType === JOB_NAMES.injectChatMessage) {
			// Refused once the run is over: the sender sends it as a new message.
			const { targetJobId, message } = job.payload;
			const accepted = this.runInboxes.get(targetJobId)?.push(message) ?? false;
			return { accepted };
		}
		if (job.jobType === JOB_NAMES.stopChat) {
			const { targetJobId } = job.payload;
			const running = this.runStops.get(targetJobId);
			if (running) {
				running.abort();
			} else {
				this.stoppedBeforeStart.add(targetJobId);
				setTimeout(
					() => this.stoppedBeforeStart.delete(targetJobId),
					STOP_MEMORY_MS,
				);
			}
			return { stopped: true };
		}

		const stop = new AbortController();
		this.runStops.set(jobId, stop);
		if (this.stoppedBeforeStart.delete(jobId)) stop.abort();
		const inbox = createFlowRunInbox();
		this.runInboxes.set(jobId, inbox);
		try {
			return await this.runChat(jobId, job, dependencies, stop.signal, inbox);
		} finally {
			this.runStops.delete(jobId);
			// Whatever the agent did not get to read goes out as a new message.
			inbox.close();
			this.runInboxes.delete(jobId);
		}
	}

	private async runChat(
		jobId: string,
		job: ChatJob,
		dependencies: ProcessDependencies,
		stopSignal: AbortSignal,
		inbox: FlowRunInbox,
	): Promise<ItemHandlerResult> {
		const {
			messages,
			model,
			mode,
			topicId,
			agentFlowId: rawAgentFlowId,
			streamConfig,
			tools,
			tool_choice,
			parallel_tool_calls,
			conversation,
			reminders,
		} = job.payload;
		// "chat" is the composer's sentinel for "no agent selected", not a flow id.
		const agentFlowId =
			rawAgentFlowId && rawAgentFlowId !== "chat" ? rawAgentFlowId : undefined;
		const startTime = Date.now();
		const currentModel = await serviceManager.llmService.getCurrentModel();
		const provider = currentModel?.provider ?? "unknown";
		const requestDefaults: RunRequestDefaults = {
			promptCacheKey: getPromptCacheKey(conversation),
			reasoningEffort: currentModel
				? await reasoningEffortSettings.get(
						reasoningEffortKey({ provider, modelId: model }),
					)
				: undefined,
		};

		// Apply default stream config
		const config: Required<ChatStreamConfig> = {
			minWordsToStream: Math.max(1, streamConfig?.minWordsToStream ?? 1),
			streamToolCallsImmediately:
				streamConfig?.streamToolCallsImmediately ?? true,
		};

		await dependencies.logger.info(
			`🤖 Starting chat job: ${jobId}`,
			{
				messageCount: messages.length,
				model,
				mode,
				streamConfig: config,
			},
			"offscreen",
		);

		let currentContent = "";
		const messagePartsAccumulator = new MessagePartsAccumulator();
		let finalMessageState: Record<string, unknown> | null = null;
		const actions: FlowAction[] = [];
		let executions: AssistantExecutionPart[] = [];
		let toolExecutions: ToolExecutionRecord[] = [];
		const compactions: ChatCompaction[] = [];
		const handleCompaction: FlowCustomPayloadDeps["handleCompaction"] = (
			report,
		) => {
			const count = (name: string) =>
				typeof report?.[name] === "number" ? (report[name] as number) : 0;
			if (!report) return undefined;
			const compaction: ChatCompaction = {
				reason: report.reason === "token-budget" ? "token-budget" : "threshold",
				beforeTokens: count("beforeTokens"),
				afterTokens: count("afterTokens"),
				windowTokens: count("windowTokens"),
				shortened: count("shortened"),
				removed: count("removed"),
				atPart: messagePartsAccumulator.toParts().length,
				at: new Date().toISOString(),
			};
			compactions.push(compaction);
			return compaction;
		};
		// Kept in the reply where the agent read it, so the next turn's history
		// has it in the same place.
		const handleUserMessage: FlowCustomPayloadDeps["handleUserMessage"] = (
			message,
		) => {
			messagePartsAccumulator.addUserMessage(message.content);
		};
		// Same for the reminders the run attached: the next turn has to send them
		// again where this one did, or its prefix stops matching there.
		const handleSystemReminder: FlowCustomPayloadDeps["handleSystemReminder"] =
			(content) => {
				messagePartsAccumulator.addSystemReminder(content);
			};
		// The reply says it was cut off, so the user can let the agent go on.
		let iterationLimit: number | undefined;
		const handleIterationLimit: FlowCustomPayloadDeps["handleIterationLimit"] =
			(maxIterations) => {
				iterationLimit = maxIterations;
			};
		const handleExecutionStart = (event: {
			node: string;
			metadata?: Record<string, unknown>;
		}) => {
			executions = addExecutionPart(executions, event);
		};
		const handleToolExecution: FlowCustomPayloadDeps["handleToolExecution"] = (
			phase,
			event,
		) => {
			const metadata = event.metadata;
			const id =
				typeof metadata?.tool_call_id === "string"
					? metadata.tool_call_id
					: undefined;
			const name =
				typeof metadata?.tool === "string" ? metadata.tool : undefined;
			if (!id || !name) return undefined;

			const existing = toolExecutions.find((item) => item.id === id);
			const toolMetadata =
				metadata?.tool_metadata &&
				typeof metadata.tool_metadata === "object" &&
				!Array.isArray(metadata.tool_metadata)
					? (metadata.tool_metadata as Record<string, unknown>)
					: undefined;
			if (phase === "start") {
				const input = createToolExecutionPreview(metadata?.input);
				const record: ToolExecutionRecord = {
					id,
					name,
					status: "running",
					startedAt:
						typeof metadata?.startedAt === "string"
							? metadata.startedAt
							: new Date().toISOString(),
					inputPreview: input.preview,
					truncated: input.truncated,
					...(toolMetadata ? { toolMetadata } : {}),
				};
				toolExecutions = upsertToolExecution(toolExecutions, record);
				return record;
			}

			const output = createToolExecutionPreview(
				metadata?.content ?? metadata?.structuredContent,
			);
			const isError = metadata?.isError === true;
			const endedAt =
				typeof metadata?.endedAt === "string"
					? metadata.endedAt
					: new Date().toISOString();
			const record: ToolExecutionRecord = {
				id,
				name,
				status: isError ? "failed" : "completed",
				startedAt: existing?.startedAt ?? endedAt,
				endedAt,
				durationMs:
					typeof metadata?.durationMs === "number"
						? metadata.durationMs
						: existing
							? Math.max(
									0,
									new Date(endedAt).getTime() -
										new Date(existing.startedAt).getTime(),
								)
							: 0,
				inputPreview: existing?.inputPreview,
				outputPreview: output.preview,
				error: isError ? output.preview : undefined,
				truncated: Boolean(existing?.truncated || output.truncated),
				...((toolMetadata ?? existing?.toolMetadata)
					? { toolMetadata: toolMetadata ?? existing?.toolMetadata }
					: {}),
			};
			toolExecutions = upsertToolExecution(toolExecutions, record);
			return record;
		};
		const toolCallAccumulator = createToolCallAccumulator();
		const getProgress = () => Math.min(80, 20 + currentContent.length / 10);

		// One dispatcher per job owns the wire rate for everything streamed back.
		const dispatcher = ChatHandler.createChunkDispatcher(
			jobId,
			model,
			dependencies,
			getProgress,
		);

		// One entry per provider request: an agent turn makes several, and the
		// message shows both the sum and how each request fared against the
		// provider's prompt cache.
		let accumulatedUsage = createAggregatedTokenUsage();
		const addUsage = (usage: TokenUsage) => {
			accumulatedUsage = addTokenUsage(accumulatedUsage, usage);
			// The chat's cost moves with every request, not only once the reply
			// is saved: a long agent turn would otherwise show the old total for
			// minutes. The per-request list stays with the saved reply.
			const { calls: _calls, ...running } = accumulatedUsage;
			dispatcher.send(() =>
				dependencies.updateJobProgress(jobId, {
					stage: "Receiving response...",
					progress: getProgress(),
					result: { type: "usage", usage: running } as ChatResult,
				}),
			);
		};
		const requests = createStoppableRequests(stopSignal, addUsage);
		// Saves the reply while it runs, so a run that is cut off (the extension
		// reloaded, the offscreen document recycled) still leaves what the user
		// watched stream in.
		const checkpointer = createReplyCheckpointer({
			snapshot: () => {
				if (!conversation) return null;
				const parts = resolveMessageParts({
					finalState: finalMessageState,
					accumulatedParts: messagePartsAccumulator.toParts(),
				});
				const key = [
					currentContent.length,
					parts.length,
					actions.length,
					toolExecutions.map((item) => item.status).join(""),
				].join(":");
				return {
					key,
					save: () =>
						ChatHandler.persistAssistantMessage({
							conversation,
							...ChatHandler.storedReplyBody(parts, currentContent),
							complexContent: null,
							metadata: {
								...ChatHandler.buildAssistantMessageMetadata({
									conversation,
									content: currentContent,
									model,
									provider,
									startTime,
									actions: normalizeActions(actions),
									executions,
									toolExecutions,
									compactions,
								}),
								incomplete: true,
							},
						}),
				};
			},
			onError: (error) =>
				void dependencies.logger.warn(
					`Failed to save the running reply for conversation ${conversation?.id}`,
					`${error}`,
					"offscreen",
				),
		});
		const finalizeConversation = async (
			input: Omit<AssistantMessagePersistence, "conversation">,
		) => {
			// Before the final write, so an older checkpoint cannot land after it.
			await checkpointer.stop();
			if (!conversation) {
				return;
			}

			try {
				const { form, fullError } = await persistReplyWithFallback(
					{
						content: input.content,
						parts: input.parts,
						// Clears the mark checkpoints left: the run is over.
						metadata: { ...input.metadata, incomplete: undefined },
					},
					(reply) =>
						ChatHandler.persistAssistantMessage({
							conversation,
							complexContent: input.complexContent,
							...reply,
						}),
					minimalReplyMetadata,
				);
				if (fullError !== undefined) {
					await dependencies.logger.warn(
						`Kept a smaller form (${form}) of the reply for conversation ${conversation.id}`,
						`${fullError}`,
						"offscreen",
					);
				}
			} catch (finalizeError) {
				await dependencies.logger.error(
					`Failed to save the reply for conversation ${conversation.id}`,
					finalizeError,
					"offscreen",
				);
			}
		};

		// The one way a run ends with an answer — finished, or stopped by the user.
		const finishRun = async () => {
			const stopped = stopSignal.aborted;
			const finalActions = normalizeActions(actions);
			const finalParts = withReplyText(
				resolveMessageParts({
					finalState: finalMessageState,
					accumulatedParts: messagePartsAccumulator.toParts(),
				}),
				currentContent,
			);
			const finalExecutions = completeExecutionParts(executions);
			const finalToolExecutions = finishRunningToolExecutions(
				toolExecutions,
				stopped ? "cancelled" : "completed",
			);
			const finalUsage =
				accumulatedUsage.total_tokens > 0 ? accumulatedUsage : undefined;
			const finalMetadata = ChatHandler.buildAssistantMessageMetadata({
				conversation,
				content: currentContent,
				model,
				provider,
				startTime,
				usage: finalUsage,
				actions: finalActions,
				executions: finalExecutions,
				toolExecutions: finalToolExecutions,
				compactions,
				stopped,
				iterationLimit,
			});
			const result = {
				type: "final",
				content: currentContent,
				parts: finalParts,
				metadata: {
					...finalMetadata,
					executions: finalExecutions,
					toolExecutions: finalToolExecutions,
				},
			} satisfies ChatResult;

			await finalizeConversation({
				...ChatHandler.storedReplyBody(finalParts, currentContent),
				complexContent: null,
				metadata: finalMetadata,
			});

			return result;
		};

		// Create stream buffer for content
		const streamBuffer = ChatHandler.createStreamBuffer({
			jobId,
			model,
			config,
			dependencies,
			dispatcher,
			onContent: (bufferedContent) => {
				currentContent += bufferedContent;
			},
			getProgress,
		});

		checkpointer.start();
		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				stage: "Initializing chat processing...",
				progress: 5,
			});

			if (mode === "agent") {
				await dependencies.updateJobProgress(jobId, {
					stage: "Running Agent...",
					progress: 20,
				});

				let flowConfig: UnifiedFlowConfig | null = null;
				try {
					// An agent selected in the composer must behave the same whichever
					// mode the UI picked. `normal` used to force the stock config here,
					// so the agent's own features — MCP connections above all — were
					// silently dropped depending on how the message was started.
					if (job.payload.flowConfig) {
						flowConfig = job.payload.flowConfig;
					} else if (agentFlowId) {
						// Same reporting as the custom branch below: silently standing
						// in the stock config for an agent asked for by id is what made
						// "the agent is ignored" so hard to see.
						const resolved =
							await serviceManager.flowBuilderService.resolveUnifiedFlowConfig({
								flowId: agentFlowId,
							});
						flowConfig = resolved.config;
						if (resolved.usedFallback) {
							await dependencies.logger.warn(
								`Ran without the selected agent (${agentFlowId})`,
								resolved.reason ?? "The selected agent could not be loaded.",
								"offscreen",
							);
						}
					} else {
						flowConfig = buildDefaultFlowConfig("agent");
					}
				} catch (err) {
					await dependencies.logger.warn(
						"Failed to load agent flow config, using defaults",
						`${err}`,
						"offscreen",
					);
				}

				const resolvedConfig = flowConfig
					? mergeWithDefaultConfig(flowConfig, flowConfig.graphType)
					: buildDefaultFlowConfig("agent");
				const resolvedConfigWithPrefix = await withResolvedConnections(
					applyMemonAbsorption(
						applyFlowConfigPrefix(resolvedConfig, job.payload.flowConfigPrefix),
					),
				);
				const stream = toLegacyFlowStream(
					createMemorallFlowRun({
						runId: `chat:${jobId}`,
						services: ChatHandler.getFlowServices(requestDefaults, requests),
						signal: stopSignal,
						input: {
							graphType: resolvedConfigWithPrefix.graphType ?? "agent",
							config: resolvedConfigWithPrefix,
							initialState: {
								messages,
								topicId,
								contextQueries: [],
								reminders,
							},
							streamModes: ["custom", "values"],
							runtimeVars: getChatRuntimeVars(
								conversation,
								`chat:${jobId}`,
								agentFlowId,
								inbox,
							),
						},
					}),
				);

				const finalState = await ChatHandler.runFlowStream({
					stream,
					executeStage: "Executing agent action...",
					handleExecutionStart,
					handleToolExecution,
					handleCompaction,
					handleUserMessage,
					handleSystemReminder,
					handleIterationLimit,
					jobId,
					model,
					config,
					dependencies,
					dispatcher,
					streamBuffer,
					actions,
					messagePartsAccumulator,
					toolCallAccumulator,
					addUsage,
					getProgress,
				});
				finalMessageState = finalState;

				streamBuffer.flush();
				// Wait for every chunk already sent, not just the buffered text: the
				// final result goes out next and must not overtake them.
				await dispatcher.drain();

				if (typeof finalState?.response === "string") {
					currentContent = finalState.response;
					await dependencies.updateJobProgress(jobId, {
						stage: "Agent complete",
						progress: 95,
						result: {
							type: "final",
							content: currentContent,
							metadata: { actions },
						} as ChatResult,
					});
				}
			} else if (mode === "custom") {
				// Load unified flow config — steps carry both their settings and enabled state.
				// Falls back to the canonical default on failure so the graph always runs.
				let flowConfig: UnifiedFlowConfig | null = null;
				// An agent asked for by id that cannot be loaded used to be replaced
				// by the stock config in silence: the run answered as somebody else,
				// with none of the agent's instructions, features or tools, and
				// nothing said so. Keep the fallback, but record it.
				let agentFallbackReason: string | undefined;
				try {
					if (job.payload.flowConfig) {
						flowConfig = job.payload.flowConfig;
					} else if (agentFlowId) {
						const resolved =
							await serviceManager.flowBuilderService.resolveUnifiedFlowConfig({
								flowId: agentFlowId,
							});
						flowConfig = resolved.config;
						if (resolved.usedFallback) {
							agentFallbackReason =
								resolved.reason ?? "The selected agent could not be loaded.";
							await dependencies.logger.warn(
								`Ran without the selected agent (${agentFlowId})`,
								agentFallbackReason,
								"offscreen",
							);
						}
					} else {
						flowConfig =
							await serviceManager.flowBuilderService.getUnifiedFlowConfig({
								predefinedFlow: "foundation",
							});
					}
				} catch (err) {
					agentFallbackReason = `${err}`;
					await dependencies.logger.warn(
						"Failed to load flow config, using defaults",
						`${err}`,
						"offscreen",
					);
				}

				let resolvedConfig = flowConfig
					? mergeWithDefaultConfig(flowConfig, flowConfig.graphType)
					: buildDefaultFlowConfig("foundation");
				resolvedConfig = await withResolvedConnections(
					applyMemonAbsorption(
						applyFlowConfigPrefix(resolvedConfig, job.payload.flowConfigPrefix),
					),
				);

				await dependencies.updateJobProgress(jobId, {
					stage: "Running Custom Flow...",
					progress: 20,
				});

				// Fetch topic info for retrieval context queries if topicId exists
				const contextQueries: string[] = [];
				let topicRecallType: RecallType | undefined;
				// "default" means no topic; the column is a uuid, so querying it
				// with that fails instead of finding nothing.
				if (topicId && isUuid(topicId)) {
					try {
						const topicInfo = await serviceManager.databaseService.use(
							async ({ db, schema }) => {
								const rows = await db
									.select()
									.from(schema.topics)
									.where(sql`${schema.topics.id} = ${topicId}`)
									.limit(1);

								if (rows.length > 0) {
									const row = rows[0];
									const name = row.name || "Unknown Topic";
									const desc = row.description || row.name || "";
									return {
										contextQuery: desc ? `${name}: ${desc}` : name,
										growType: row.growType,
										recallType: row.recallType,
									};
								}
								return undefined;
							},
						);
						if (topicInfo) {
							contextQueries.push(topicInfo.contextQuery);
							topicRecallType = isRecallTypeValidForGrow(
								topicInfo.growType,
								topicInfo.recallType,
							)
								? topicInfo.recallType
								: getValidRecallTypes(topicInfo.growType)[0];
						}
					} catch (error) {
						await dependencies.logger.warn(
							`Failed to fetch topic info for ${topicId}:`,
							`${error}`,
							"offscreen",
						);
					}
				}

				resolvedConfig = applyTopicRecallType(resolvedConfig, topicRecallType);
				const graphType = resolvedConfig.graphType ?? "foundation";

				const stream = toLegacyFlowStream(
					createMemorallFlowRun({
						runId: `chat:${jobId}`,
						services: ChatHandler.getFlowServices(requestDefaults, requests),
						signal: stopSignal,
						input: {
							graphType,
							config: resolvedConfig,
							initialState: { messages, topicId, contextQueries, reminders },
							streamModes: ["custom", "updates", "values"],
							runtimeVars: getChatRuntimeVars(
								conversation,
								`chat:${jobId}`,
								agentFlowId,
								inbox,
							),
						},
					}),
				);

				const finalState = (await ChatHandler.runFlowStream({
					stream,
					executeStage: "Executing...",
					handleExecutionStart,
					handleToolExecution,
					handleCompaction,
					handleUserMessage,
					handleSystemReminder,
					handleIterationLimit,
					jobId,
					model,
					config,
					dependencies,
					dispatcher,
					streamBuffer,
					actions,
					messagePartsAccumulator,
					toolCallAccumulator,
					addUsage,
					getProgress,
				})) as FoundationState | null;
				finalMessageState = finalState as unknown as Record<
					string,
					unknown
				> | null;

				// Flush any remaining buffered content from streaming
				streamBuffer.flush();
				// Wait for every chunk already sent, not just the buffered text: the
				// final result goes out next and must not overtake them.
				await dispatcher.drain();

				// Say it out loud when the answer did not come from the agent the
				// user picked, rather than letting a stock run pass for theirs.
				if (agentFallbackReason) {
					await dependencies.updateJobProgress(jobId, {
						stage: "Ran without the selected agent",
						progress: 95,
						result: {
							type: "agent-fallback",
							agentFlowId,
							reason: agentFallbackReason,
						} as unknown as ChatResult,
					});
				}

				if (finalState) {
					const response = finalState.response;

					// If found and different from current content, update
					if (response && response !== currentContent) {
						currentContent = response;

						// Send a final update to replace the streamed content with cited version
						await dependencies.updateJobProgress(jobId, {
							stage: "Adding citations...",
							progress: 95,
							result: {
								type: "final",
								content: response,
								metadata: { actions },
							} as ChatResult,
						});
					}
				}
			} else {
				// Normal mode - direct LLM call (following use-chat.ts pattern exactly)
				// One request, so the reminders sit right after the newest message;
				// the reply keeps them there for the next turn's history.
				const reminderMessage = systemReminderMessage(reminders);
				if (reminderMessage) {
					handleSystemReminder(reminderMessage.content);
					dispatcher.send(() =>
						dependencies.updateJobProgress(jobId, {
							stage: "Sending request to LLM...",
							progress: 20,
							result: {
								type: "system-reminder",
								content: reminderMessage.content,
							} as ChatResult,
						}),
					);
				}
				const request: ChatCompletionRequest = {
					messages: reminderMessage ? [...messages, reminderMessage] : messages,
					model: model,
					temperature: 0.3,
					stream: true,
					tools,
					tool_choice,
					parallel_tool_calls,
					prompt_cache_key: requestDefaults.promptCacheKey,
					reasoning_effort: requestDefaults.reasoningEffort,
				};

				await dependencies.updateJobProgress(jobId, {
					stage: "Sending request to LLM...",
					progress: 20,
				});

				if (request.stream) {
					// For streaming, the result should be an AsyncIterableIterator
					const stream = requests.track(
						serviceManager.llmService.chatCompletions({
							...request,
							signal: stopSignal,
						}) as AsyncIterableIterator<ChatCompletionChunk>,
						request.messages,
					);
					const handleChunk = ChatHandler.createHandleChunk({
						jobId,
						model,
						config,
						dependencies,
						dispatcher,
						streamBuffer,
						getProgress,
						onChunk: (chunk) => messagePartsAccumulator.addChunk(chunk),
						onUsage: addUsage,
						onToolCalls: (toolCalls) =>
							accumulateChunkToolCalls(toolCallAccumulator, toolCalls),
					});
					await ChatHandler.streamChatCompletions(stream, handleChunk);
				}

				// Flush any remaining buffered content
				streamBuffer.flush();
				// Wait for every chunk already sent, not just the buffered text: the
				// final result goes out next and must not overtake them.
				await dispatcher.drain();
			}

			return await finishRun();
		} catch (error) {
			if (stopSignal.aborted) {
				// Stopping is not a failure. Whatever the run did up to here — text,
				// steps, tool calls, tokens — is its answer, kept the same way a
				// finished one is; only the loop that would have gone on is cut.
				streamBuffer.flush();
				await dispatcher.drain();
				await requests.settle();
				await dependencies.logger.info(
					`⏹️ Chat job ${jobId} stopped by the user`,
					undefined,
					"offscreen",
				);
				return await finishRun();
			}

			// Drop any queued content and its pending timer: the turn is over, and a
			// late flush would post progress for a job that has already failed.
			dispatcher.flush();
			const errorMessage = getErrorMessage(error);
			const errorMetadata = createJobErrorMetadata(error);
			const isAbort = isAbortError(error);
			const errorUsage =
				accumulatedUsage.total_tokens > 0 ? accumulatedUsage : undefined;
			try {
				const errorParts = resolveMessageParts({
					finalState: finalMessageState,
					accumulatedParts: messagePartsAccumulator.toParts(),
				});
				const persistenceMetadata = ChatHandler.buildAssistantMessageMetadata({
					conversation,
					content: currentContent,
					model,
					provider,
					startTime,
					usage: errorUsage,
					actions: normalizeActions(actions),
					executions: completeExecutionParts(executions),
					toolExecutions: finishRunningToolExecutions(
						toolExecutions,
						isAbort ? "cancelled" : "failed",
					),
					compactions,
					error: isAbort ? undefined : errorMetadata,
				});
				await finalizeConversation({
					...ChatHandler.storedReplyBody(errorParts, currentContent),
					complexContent: null,
					metadata: persistenceMetadata,
				});
			} catch (persistError) {
				await dependencies.logger.warn(
					`Failed to persist error state for job ${jobId}`,
					`${persistError}`,
					"offscreen",
				);
			}

			await dependencies.logger.error(
				`❌ Chat job ${jobId} failed`,
				error,
				"offscreen",
			);

			await dependencies.updateJobProgress(jobId, {
				stage: "Chat failed",
				progress: 100,
				error: errorMessage,
				metadata: { error: errorMetadata },
			});

			throw error;
		} finally {
			await checkpointer.stop();
		}
	}
}

// Register the handler
const chatHandler = new ChatHandler();
handlerRegistry.register({
	instance: chatHandler,
	jobs: [JOB_NAMES.chat, JOB_NAMES.stopChat, JOB_NAMES.injectChatMessage],
});

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		chat: ChatPayload;
		"stop-chat": StopChatPayload;
		"inject-chat-message": InjectChatMessagePayload;
	}

	interface JobResultRegistry {
		chat: ChatResult;
		"stop-chat": { stopped: boolean };
		/** False when the run was already over. */
		"inject-chat-message": { accepted: boolean };
	}
}
