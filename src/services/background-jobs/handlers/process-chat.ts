import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { serviceManager } from "@/services";
import type {
	ChatCompletionRequest,
	ChatMessage,
	ChatCompletionChunk,
	ChatCompletionChunkToolCall,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
} from "@/types/openai";
import {
	isCustomChunkPayload,
	normalizeLangGraphStreamChunk,
	type FlowAction,
} from "@/services/flows-legacy/utils/langgraph-stream";
import type {
	AssistantExecutionPart,
	ComplexContent,
	ConversationContext,
	MessageParts,
	ToolExecutionRecord,
} from "@/types/chat";
import { handlerRegistry } from "./handler-registry";
import type { FoundationState } from "@/services/flows-legacy/graph/foundation/state";
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
	consoleFlowLogger,
	toFlowDatabase,
	toFlowEmbedding,
	toFlowFileSystem,
	toFlowLLM,
	toFlowSandbox,
	toFlowWebBrowser,
	toAgentSandbox,
} from "@/services/flow-service-adapters";
import {
	createMemorallFlowRun,
	toLegacyFlowStream,
	type MemorallFlowServices,
} from "@/services/agent-harness";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import { buildDefaultFlowConfig } from "@/services/flows-legacy/utils/flow-config";
import { mergeWithDefaultConfig } from "@/services/flows-legacy/utils/flow-config";
import { eq, sql } from "drizzle-orm";
import { documentFileSystemService as fsService } from "@/services/filesystem/document-filesystem";
import {
	getValidRecallTypes,
	isRecallTypeValidForGrow,
	type RecallType,
} from "@/services/database/entities/topic-types";
import {
	createJobErrorMetadata,
	getErrorMessage,
	type JobErrorMetadata,
} from "./error-metadata";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { isAbortError } from "@/utils/abort";
import { StreamBuffer } from "./stream-buffer";
import {
	createToolExecutionPreview,
	finishRunningToolExecutions,
	upsertToolExecution,
} from "@/services/chat/tool-executions";
import type { GraphTool } from "@/services/flows-legacy/graph/graph.base";
import {
	THREAD_HISTORY_CONVERSATION_RUNTIME_KEY,
	THREAD_HISTORY_READ_TOOL,
	THREAD_HISTORY_SEARCH_TOOL,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-legacy/tools/thread-history";
export { StreamBuffer } from "./stream-buffer";

export interface ChatStreamConfig {
	/** Minimum number of words to buffer before streaming (default: 5) */
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

const withThreadHistoryTools = (
	config: UnifiedFlowConfig,
	conversation: ConversationContext | undefined,
): UnifiedFlowConfig => {
	if (!hasThreadHistory(conversation)) return config;
	const historyTools: GraphTool[] = [
		THREAD_HISTORY_SEARCH_TOOL,
		THREAD_HISTORY_READ_TOOL,
	];
	return {
		...config,
		steps: config.steps.map((step) => {
			if (step.name === "chat-completion") {
				return { ...step, enabled: false };
			}
			if (step.name !== "agent-completion") return step;
			const existing = Array.isArray(step.config?.tools)
				? (step.config.tools as GraphTool[])
				: [];
			const byName = new Map<string, GraphTool>();
			for (const tool of [...existing, ...historyTools]) {
				byName.set(typeof tool === "string" ? tool : tool.name, tool);
			}
			return {
				...step,
				enabled: true,
				config: { ...step.config, tools: [...byName.values()] },
			};
		}),
	};
};

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
	onContent: (content: string) => void;
	getProgress: () => number;
};

type FlowCustomPayloadDeps = {
	payload: unknown;
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

	private static createStreamBuffer(deps: StreamBufferDeps): StreamBuffer {
		return new StreamBuffer(deps.config.minWordsToStream, (bufferedContent) => {
			deps.onContent(bufferedContent);
			deps.dependencies.updateJobProgress(deps.jobId, {
				stage: "Receiving response...",
				progress: deps.getProgress(),
				result: {
					type: "chunk",
					chunk: {
						id: `chunk-${Date.now()}`,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model: deps.model,
						choices: [
							{
								index: 0,
								delta: { content: bufferedContent, role: "assistant" },
								finish_reason: null,
							},
						],
					},
				} as ChatResult,
			});
		});
	}

	private static hasToolCalls(
		delta: ChatCompletionChunk["choices"][number]["delta"] | undefined,
	): boolean {
		return Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
	}

	private static createHandleChunk(deps: FlowStreamDeps) {
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

			if (shouldStreamToolCalls || delta?.role || choice.finish_reason) {
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

				await deps.dependencies.updateJobProgress(deps.jobId, {
					stage: "Receiving response...",
					progress: deps.getProgress(),
					result: {
						type: "chunk",
						chunk: chunkToSend,
					} as ChatResult,
				});
			}
		};
	}

	private static createFlowHandleActions(
		dependencies: ProcessDependencies,
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
				dependencies.updateJobProgress(jobId, {
					stage: "Receiving response...",
					progress: 10,
					result: {
						type: "action",
						actions,
					} as ChatResult,
				});
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
				streamBuffer,
				getProgress,
				onChunk: (chunk) => messagePartsAccumulator.addChunk(chunk),
				onUsage: addUsage,
				onToolCalls: (toolCalls) =>
					accumulateChunkToolCalls(toolCallAccumulator, toolCalls),
			}),
			handleActions: ChatHandler.createFlowHandleActions(
				dependencies,
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
					await dependencies.updateJobProgress(jobId, {
						stage: executeStage,
						progress: 12,
						result: {
							type: "execute-start",
							node: event.node,
							metadata: event.metadata,
						} as ChatResult,
					});
					if (execution) {
						await dependencies.updateJobProgress(jobId, {
							stage: executeStage,
							progress: 12,
							result: { type: "tool-execution", execution } as ChatResult,
						});
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
						await dependencies.updateJobProgress(jobId, {
							stage: executeStage,
							progress: 14,
							result: { type: "tool-execution", execution } as ChatResult,
						});
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
			agentFlowId,
			streamConfig,
			tools,
			tool_choice,
			parallel_tool_calls,
			conversation,
		} = job.payload;
		const startTime = Date.now();
		const provider =
			(await serviceManager.llmService.getCurrentModel())?.provider ??
			"unknown";

		// Apply default stream config
		const config: Required<ChatStreamConfig> = {
			minWordsToStream: streamConfig?.minWordsToStream ?? 5,
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

		// Create stream buffer for content
		const streamBuffer = ChatHandler.createStreamBuffer({
			jobId,
			model,
			config,
			dependencies,
			onContent: (bufferedContent) => {
				currentContent += bufferedContent;
			},
			getProgress: () => Math.min(80, 20 + currentContent.length / 10),
		});

		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				stage: "Initializing chat processing...",
				progress: 5,
			});

			if (mode === "agent" || (mode === "normal" && hasThreadHistory(conversation))) {
				await dependencies.updateJobProgress(jobId, {
					stage: "Running Agent...",
					progress: 20,
				});

				let flowConfig: UnifiedFlowConfig | null = null;
				try {
					flowConfig =
						mode === "normal"
							? buildDefaultFlowConfig("agent")
							: job.payload.flowConfig
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
				const resolvedConfigWithPrefix = withThreadHistoryTools(
					applyFlowConfigPrefix(resolvedConfig, job.payload.flowConfigPrefix),
					conversation,
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
					streamBuffer,
					actions,
					messagePartsAccumulator,
					toolCallAccumulator,
					addUsage,
					getProgress: () => Math.min(80, 20 + currentContent.length / 10),
				});
				finalMessageState = finalState;

				streamBuffer.flush();

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
				resolvedConfig = applyFlowConfigPrefix(
					resolvedConfig,
					job.payload.flowConfigPrefix,
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

				resolvedConfig = withThreadHistoryTools(
					applyTopicRecallType(resolvedConfig, topicRecallType),
					conversation,
				);
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
					streamBuffer,
					actions,
					messagePartsAccumulator,
					toolCallAccumulator,
					addUsage,
					getProgress: () => Math.min(80, 20 + currentContent.length / 10),
				})) as FoundationState | null;
				finalMessageState = finalState as unknown as Record<
					string,
					unknown
				> | null;

				// Flush any remaining buffered content from streaming
				streamBuffer.flush();

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
						streamBuffer,
						getProgress: () => Math.min(80, 20 + currentContent.length / 10),
						onChunk: (chunk) => messagePartsAccumulator.addChunk(chunk),
						onUsage: addUsage,
						onToolCalls: (toolCalls) =>
							accumulateChunkToolCalls(toolCallAccumulator, toolCalls),
					});
					await ChatHandler.streamChatCompletions(stream, handleChunk);
				}

				// Flush any remaining buffered content
				streamBuffer.flush();
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
