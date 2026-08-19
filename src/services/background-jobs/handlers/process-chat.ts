import type { FoundationState } from "@memorall/agent-harness-flows/graph/foundation/state";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
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
import { serviceManager } from "@/services";
import {
	createMemorallFlowRun,
	type MemorallFlowServices,
	toLegacyFlowStream,
} from "@/services/agent-harness";
import {
	MessagePartsAccumulator,
	resolveMessageParts,
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
	toFlowSandbox,
	toFlowWebBrowser,
} from "@/services/flow-service-adapters";
import {
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";
import { withResolvedConnections } from "@/services/mcp-connections";
import type {
	AssistantExecutionPart,
	ComplexContent,
	ConversationContext,
	MessageParts,
	ToolExecutionRecord,
} from "@/types/chat";
import type {
	ChatCompletionChunk,
	ChatCompletionChunkToolCall,
	ChatCompletionMessageToolCall,
	ChatCompletionRequest,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
	ChatMessage,
} from "@/types/openai";
import { isAbortError } from "@/utils/abort";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { BaseProcessHandler } from "./base-process-handler";
import {
	createJobErrorMetadata,
	getErrorMessage,
	type JobErrorMetadata,
} from "./error-metadata";
import { handlerRegistry } from "./handler-registry";
import { ChunkDispatcher, StreamBuffer } from "./stream-buffer";
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
				tool_calls?: ChatCompletionMessageToolCall[];
				usage?: {
					prompt_tokens: number;
					completion_tokens: number;
					total_tokens: number;
				};
				model?: string;
				provider?: string;
				timeToAnswer?: number;
				tokensPerSecond?: number;
				estimatedTokens?: number;
				agentFlowName?: string;
				error?: JobErrorMetadata;
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
} as const;

export type ChatJob = BaseJob & {
	jobType: typeof JOB_NAMES.chat;
	payload: ChatPayload;
};

type TokenUsage = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
};

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
};

type AssistantMessageFinalization = {
	conversation?: ConversationContext;
	content: string;
	model: string;
	provider: string;
	startTime: number;
	usage?: TokenUsage;
	actions: ChatResultFinalAction[];
	executions: AssistantExecutionPart[];
	toolExecutions: ToolExecutionRecord[];
	error?: JobErrorMetadata;
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
	usage?: TokenUsage;
	agentFlowName?: string;
	error?: JobErrorMetadata;
};

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

export class ChatHandler extends BaseProcessHandler<ChatJob> {
	constructor() {
		super();
	}

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
					content,
					complexContent,
					parts,
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
		error,
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
			...(conversation?.agentFlowName
				? { agentFlowName: conversation.agentFlowName }
				: {}),
			...(usage ? { usage } : {}),
			...(error ? { error } : {}),
		};
	}

	private static contentChunkUpdate(
		model: string,
		content: string,
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
							delta: { content, role: "assistant" },
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
	 * Content is throttled and merged; anything else flushes it first and is sent
	 * straight away. One place decides the wire rate, so the word-buffer above it
	 * stays a readability knob rather than the thing that sets IPC volume.
	 */
	private static createChunkDispatcher(
		jobId: string,
		model: string,
		dependencies: ProcessDependencies,
		getProgress: () => number,
	): ChunkDispatcher {
		return new ChunkDispatcher({
			intervalMs: CHUNK_DISPATCH_INTERVAL_MS,
			sendContent: (content) =>
				dependencies.updateJobProgress(
					jobId,
					ChatHandler.contentChunkUpdate(model, content, getProgress()),
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
		// field the consumer already has. Announce it once and let content flow
		// through the buffer alone.
		let assistantRoleAnnounced = false;

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

			const shouldStreamToolCalls =
				deps.config.streamToolCallsImmediately &&
				ChatHandler.hasToolCalls(delta);
			if (shouldStreamToolCalls) {
				deps.onToolCalls?.(delta.tool_calls);
			}

			const isToolResultChunk = delta?.role === "tool" || !!delta?.tool_call_id;
			const content = isToolResultChunk ? "" : (delta?.content ?? "");
			if (content) {
				deps.streamBuffer.add(content);
			}

			const isNewRoleAnnouncement =
				delta?.role === "assistant" && !assistantRoleAnnounced;
			if (isNewRoleAnnouncement) {
				assistantRoleAnnounced = true;
			}

			const carriesMetadata =
				shouldStreamToolCalls ||
				isToolResultChunk ||
				Boolean(choice.finish_reason) ||
				isNewRoleAnnouncement;
			if (!carriesMetadata) {
				return;
			}

			const chunkToSend = content
				? {
						...chunk,
						choices: [
							{
								...choice,
								delta: {
									...delta,
									content: undefined,
								},
							},
						],
					}
				: chunk;

			deps.dispatcher.send(() =>
				deps.dependencies.updateJobProgress(deps.jobId, {
					stage: "Receiving response...",
					progress: deps.getProgress(),
					result: {
						type: "chunk",
						chunk: chunkToSend,
					} as ChatResult,
				}),
			);
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

	private static getFlowServices(): FlowServices {
		const sandboxService = serviceManager.getSandboxContainerService();
		const fileSystem = toFlowFileSystem(fsService);
		return {
			llm: toFlowLLM(serviceManager.llmService),
			embedding: toFlowEmbedding(serviceManager.embeddingService),
			database: toFlowDatabase(serviceManager.databaseService),
			logger: consoleFlowLogger,
			sandboxContainer: toFlowSandbox(sandboxService),
			sandboxRuntime: toAgentSandbox(sandboxService, fileSystem),
			webBrowser: toFlowWebBrowser(serviceManager.getWebBrowserService()),
			fs: fileSystem,
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

	async process(
		jobId: string,
		job: ChatJob,
		dependencies: ProcessDependencies,
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
		} = job.payload;
		// "chat" is the composer's sentinel for "no agent selected", not a flow id.
		const agentFlowId =
			rawAgentFlowId && rawAgentFlowId !== "chat" ? rawAgentFlowId : undefined;
		const startTime = Date.now();
		const provider =
			(await serviceManager.llmService.getCurrentModel())?.provider ??
			"unknown";

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
		const accumulatedUsage: TokenUsage = {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0,
		};
		const addUsage = (usage: TokenUsage) => {
			accumulatedUsage.prompt_tokens += usage.prompt_tokens;
			accumulatedUsage.completion_tokens += usage.completion_tokens;
			accumulatedUsage.total_tokens += usage.total_tokens;
		};
		const finalizeConversation = async (
			input: Omit<AssistantMessagePersistence, "conversation">,
		) => {
			if (!conversation) {
				return;
			}

			try {
				await ChatHandler.persistAssistantMessage({
					conversation,
					...input,
				});
			} catch (finalizeError) {
				await dependencies.logger.warn(
					`Failed to finalize assistant message for conversation ${conversation.id}`,
					`${finalizeError}`,
					"offscreen",
				);
			}
		};

		const getProgress = () => Math.min(80, 20 + currentContent.length / 10);

		// One dispatcher per job owns the wire rate for everything streamed back.
		const dispatcher = ChatHandler.createChunkDispatcher(
			jobId,
			model,
			dependencies,
			getProgress,
		);

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
					flowConfig = job.payload.flowConfig
						? job.payload.flowConfig
						: agentFlowId
							? await serviceManager.flowBuilderService.getUnifiedFlowConfig({
									flowId: agentFlowId,
								})
							: buildDefaultFlowConfig("agent");
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
					applyFlowConfigPrefix(resolvedConfig, job.payload.flowConfigPrefix),
				);
				const stream = toLegacyFlowStream(
					createMemorallFlowRun({
						runId: `chat:${jobId}`,
						services: ChatHandler.getFlowServices(),
						input: {
							graphType: resolvedConfigWithPrefix.graphType ?? "agent",
							config: resolvedConfigWithPrefix,
							initialState: { messages, topicId, contextQueries: [] },
							streamModes: ["custom", "values"],
							runtimeVars: getThreadHistoryRuntimeVars(conversation),
						},
					}),
				);

				const finalState = await ChatHandler.runFlowStream({
					stream,
					executeStage: "Executing agent action...",
					handleExecutionStart,
					handleToolExecution,
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
				dispatcher.flush();

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
				try {
					flowConfig = job.payload.flowConfig
						? job.payload.flowConfig
						: agentFlowId
							? await serviceManager.flowBuilderService.getUnifiedFlowConfig({
									flowId: agentFlowId,
								})
							: await serviceManager.flowBuilderService.getUnifiedFlowConfig({
									predefinedFlow: "foundation",
								});
				} catch (err) {
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
					applyFlowConfigPrefix(resolvedConfig, job.payload.flowConfigPrefix),
				);

				await dependencies.updateJobProgress(jobId, {
					stage: "Running Custom Flow...",
					progress: 20,
				});

				// Fetch topic info for retrieval context queries if topicId exists
				const contextQueries: string[] = [];
				let topicRecallType: RecallType | undefined;
				if (topicId) {
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
						services: ChatHandler.getFlowServices(),
						input: {
							graphType,
							config: resolvedConfig,
							initialState: { messages, topicId, contextQueries },
							streamModes: ["custom", "updates", "values"],
							runtimeVars: getThreadHistoryRuntimeVars(conversation),
						},
					}),
				);

				const finalState = (await ChatHandler.runFlowStream({
					stream,
					executeStage: "Executing...",
					handleExecutionStart,
					handleToolExecution,
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
				dispatcher.flush();

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
				const request: ChatCompletionRequest = {
					messages: messages,
					model: model,
					temperature: 0.3,
					stream: true,
					tools,
					tool_choice,
					parallel_tool_calls,
				};

				await dependencies.updateJobProgress(jobId, {
					stage: "Sending request to LLM...",
					progress: 20,
				});

				if (request.stream) {
					// For streaming, the result should be an AsyncIterableIterator
					const stream = serviceManager.llmService.chatCompletions(
						request,
					) as AsyncIterableIterator<ChatCompletionChunk>;
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
				dispatcher.flush();
			}

			const finalActions = normalizeActions(actions);
			const finalParts = resolveMessageParts({
				finalState: finalMessageState,
				accumulatedParts: messagePartsAccumulator.toParts(),
			});
			const finalExecutions = completeExecutionParts(executions);
			const finalToolExecutions = finishRunningToolExecutions(
				toolExecutions,
				"completed",
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
				content: finalParts.length > 0 ? "" : currentContent,
				complexContent: null,
				parts: finalParts.length > 0 ? finalParts : null,
				metadata: finalMetadata,
			});

			return result;
		} catch (error) {
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
					error: isAbort ? undefined : errorMetadata,
				});
				await finalizeConversation({
					content: errorParts.length > 0 ? "" : currentContent,
					complexContent: null,
					parts: errorParts.length > 0 ? errorParts : null,
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
		}
	}
}

// Register the handler
const chatHandler = new ChatHandler();
handlerRegistry.register({
	instance: chatHandler,
	jobs: [JOB_NAMES.chat],
});

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		chat: ChatPayload;
	}

	interface JobResultRegistry {
		chat: ChatResult;
	}
}
