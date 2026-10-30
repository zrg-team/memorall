import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	ChatResult,
	ChatRunInfo,
	ChatStreamConfig,
} from "@/services/background-jobs/handlers/process-chat";
import type { JobErrorMetadata } from "@/services/background-jobs/handlers/error-metadata";
import type { JobProgressEvent } from "@/services/background-jobs/handlers/types";
import {
	cloneMessageParts,
	MessagePartsAccumulator,
} from "@/services/chat/message-parts";
import {
	accumulateChunkToolCalls,
	createToolCallAccumulator,
	getAccumulatedToolCalls,
} from "@/services/chat/tool-call-accumulator";
import type {
	ComplexContent,
	ConversationContext,
	MessageParts,
	ChatCompaction,
	ToolExecutionRecord,
} from "@/types/chat";
import type { AggregatedTokenUsage } from "@/services/llm/utils/token-usage";
import type { RunUsage } from "../utils/conversation-cost-format";
import { ABORT_ERROR_MESSAGE } from "@/utils/abort";
import type {
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
	ChatMessage,
} from "@/types/openai";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";

export type ChatMode = "normal" | "custom" | "agent";

export interface ChatServiceOptions {
	messages: ChatMessage[];
	model: string;
	mode: ChatMode;
	topicId?: string;
	agentFlowId?: string;
	flowConfig?: UnifiedFlowConfig;
	/** Extra steps added to the chosen agent's flow, not a replacement for it. */
	flowConfigPrefix?: UnifiedFlowConfig;
	streamConfig?: ChatStreamConfig;
	tools?: ChatCompletionTool[];
	tool_choice?: ChatCompletionToolChoiceOption;
	parallel_tool_calls?: boolean;
	conversation?: ConversationContext;
	/**
	 * Context for the model, attached after the newest message and kept in the
	 * reply, never shown as something the user wrote.
	 */
	reminders?: string[];
}

export interface ChatAction {
	id: string;
	name: string;
	description: string;
	metadata: Record<string, unknown>;
}

export interface ChatStreamCallbacks {
	onContent?: (content: string) => void;
	onContentParts?: (parts: ComplexContent) => void;
	onParts?: (parts: MessageParts) => void;
	onAction?: (actions: ChatAction[]) => void;
	onExecuteStart?: (event: {
		node: string;
		metadata?: Record<string, unknown>;
	}) => void;
	onToolExecution?: (execution: ToolExecutionRecord) => void;
	/** The conversation was compacted before the next request. */
	onCompaction?: (compaction: ChatCompaction) => void;
	/** The run started; its job id is what `injectMessage` and stop address. */
	onRunStarted?: (jobId: string) => void;
	/** The agent read a message injected into the run. */
	onInjectedMessageRead?: (message: InjectedMessage) => void;
	/** What the reply has used so far, after each model request. */
	onUsage?: (usage: RunUsage) => void;
	onError?: (error: string) => void;
}

/** A message sent to a run in progress, read before the agent's next request. */
export interface InjectedMessage {
	id: string;
	content: string;
}

export interface ChatStreamResult {
	content: string;
	contentParts: ComplexContent;
	parts?: MessageParts;
	actions: ChatAction[];
	toolCalls?: ChatCompletionMessageToolCall[];
	failed: boolean;
	error?: string;
	errorMetadata?: JobErrorMetadata;
	metadata?: Record<string, unknown>;
	usage?: AggregatedTokenUsage;
	/** The caller stopped the run; `metadata` is missing if it never reported back. */
	stopped?: boolean;
}

/**
 * How long a stopped run gets to hand back its final message.
 *
 * A stop ends the run in the background, which then reports what it did like
 * any finished run — usually within a moment. If it never does, the reader lets
 * go rather than hold the chat open.
 */
const STOP_GRACE_MS = 5_000;

const DETACHED = Symbol("detached");

const requestRunStop = (targetJobId: string) =>
	void backgroundJob
		.execute("stop-chat", { targetJobId }, { stream: false })
		.then(({ promise }) => promise.catch(() => undefined))
		.catch(() => undefined);

const mergeActions = (
	current: ChatAction[],
	incoming: ChatAction[],
): ChatAction[] => {
	if (incoming.length === 0) {
		return current;
	}

	const merged = [...current];

	for (const action of incoming) {
		const existingIndex = merged.findIndex((item) => item.id === action.id);
		if (existingIndex === -1) {
			merged.push(action);
			continue;
		}

		merged[existingIndex] = action;
	}

	return merged;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getProgressErrorMetadata = (
	metadata: Record<string, unknown> | undefined,
	fallbackMessage: string,
): JobErrorMetadata => {
	const error = metadata?.error;
	if (isRecord(error) && typeof error.message === "string") {
		return {
			message: error.message,
			rawMessage:
				typeof error.rawMessage === "string"
					? error.rawMessage
					: fallbackMessage,
			statusCode:
				typeof error.statusCode === "number" ? error.statusCode : undefined,
			code:
				typeof error.code === "string" || typeof error.code === "number"
					? error.code
					: undefined,
			providerName:
				typeof error.providerName === "string" || error.providerName === null
					? error.providerName
					: undefined,
			userId: typeof error.userId === "string" ? error.userId : undefined,
		};
	}

	return {
		message: typeof error === "string" ? error : fallbackMessage,
		rawMessage: fallbackMessage,
	};
};

/**
 * Reads a chat run's progress events into the reply they build, telling the
 * callbacks as it goes; one per run. The runs this page starts are read this
 * way, and so is a run started elsewhere that the page shows live (the
 * co-agent answering on a web page).
 */
export class ChatProgressReader {
	content = "";
	readonly actions: ChatAction[] = [];
	parts: MessageParts | undefined;
	usage: ChatStreamResult["usage"];
	metadata: Record<string, unknown> | undefined;
	failed = false;
	error = "";
	errorMetadata: JobErrorMetadata | undefined;
	private readonly toolCallAccumulator = createToolCallAccumulator();
	private readonly messagePartsAccumulator = new MessagePartsAccumulator();

	constructor(private readonly callbacks?: ChatStreamCallbacks) {}

	/** The reply's parts: the final ones, else what has streamed so far. */
	get partsSoFar(): MessageParts | undefined {
		return this.parts ?? this.messagePartsAccumulator.toParts();
	}

	get toolCalls(): ChatCompletionMessageToolCall[] | undefined {
		return getAccumulatedToolCalls(this.toolCallAccumulator);
	}

	private emitParts(): void {
		const nextParts = cloneMessageParts(this.parts);
		if (nextParts) this.callbacks?.onParts?.(nextParts);
	}

	private keepToolCalls(
		toolCalls: ChatCompletionMessageToolCall[] | undefined,
	): void {
		if (!toolCalls?.length) return;
		for (const [index, toolCall] of toolCalls.entries()) {
			this.toolCallAccumulator.set(index, toolCall);
		}
	}

	/** Takes one progress event. False once the run has failed: read no more. */
	read(progress: JobProgressEvent): boolean {
		const callbacks = this.callbacks;

		// Handle failure
		if (progress.status === "failed") {
			this.failed = true;
			this.error = progress.error || "Chat request failed";
			this.errorMetadata = getProgressErrorMetadata(
				progress.metadata,
				this.error,
			);
			callbacks?.onError?.(this.errorMetadata.message);
			return false;
		}

		// Handle completion - get final content
		if (progress.status === "completed" && progress.result) {
			const chatResult = progress.result as ChatResult;
			if (chatResult.type === "final") {
				// Use the final content from the job result
				this.content = chatResult.content;
				this.metadata = chatResult.metadata;
				if (chatResult.metadata?.actions) {
					this.actions.splice(
						0,
						this.actions.length,
						...mergeActions(this.actions, chatResult.metadata.actions),
					);
				}
				if (chatResult.parts) {
					this.parts = chatResult.parts;
					this.emitParts();
				}
				this.keepToolCalls(chatResult.metadata?.tool_calls);
				if (chatResult.metadata?.usage) {
					this.usage = chatResult.metadata.usage;
				}
			}
		}

		// Process streaming updates
		if (
			!["processing", "pending"].includes(progress.status) ||
			!progress.result
		) {
			return true;
		}
		const chatResult = progress.result as ChatResult;
		const accumulator = this.messagePartsAccumulator;

		if (chatResult.type === "chunk" && chatResult.chunk) {
			accumulator.addChunk(chatResult.chunk);
			// `toParts()` already hands back a fresh copy, so the streaming path —
			// the one that runs per chunk — hands it straight on instead of
			// cloning the same array a second time.
			this.parts = accumulator.toParts();
			if (this.parts) callbacks?.onParts?.(this.parts);
			accumulateChunkToolCalls(
				this.toolCallAccumulator,
				chatResult.chunk.choices[0]?.delta?.tool_calls,
			);
			// Handle streaming content chunks
			const delta = chatResult.chunk.choices[0]?.delta;
			const isToolResultChunk = delta?.role === "tool" || !!delta?.tool_call_id;
			const content = isToolResultChunk ? "" : delta?.content;
			if (content) {
				this.content += content;
				callbacks?.onContent?.(this.content);
			}
		} else if (chatResult.type === "action" && chatResult.actions) {
			// Handle action updates
			this.actions.splice(
				0,
				this.actions.length,
				...mergeActions(this.actions, chatResult.actions),
			);
			callbacks?.onAction?.([...this.actions]);
		} else if (chatResult.type === "execute-start") {
			callbacks?.onExecuteStart?.({
				node: chatResult.node,
				metadata: chatResult.metadata,
			});
		} else if (chatResult.type === "tool-execution") {
			callbacks?.onToolExecution?.(chatResult.execution);
		} else if (chatResult.type === "compaction") {
			callbacks?.onCompaction?.(chatResult.compaction);
		} else if (chatResult.type === "user-message") {
			// Placed where the agent read it, as the saved reply has it.
			accumulator.addUserMessage(chatResult.content);
			this.parts = accumulator.toParts();
			callbacks?.onParts?.(this.parts);
			callbacks?.onInjectedMessageRead?.({
				id: chatResult.id,
				content: chatResult.content,
			});
		} else if (chatResult.type === "usage") {
			callbacks?.onUsage?.(chatResult.usage);
		} else if (chatResult.type === "system-reminder") {
			// Kept where the model read it, as the saved reply has it; the message
			// view never shows it.
			accumulator.addSystemReminder(chatResult.content);
			this.parts = accumulator.toParts();
			callbacks?.onParts?.(this.parts);
		} else if (chatResult.type === "final") {
			// Handle final content update (e.g., after citation step). This
			// replaces the accumulated content with the final version.
			this.content = chatResult.content;
			this.metadata = chatResult.metadata;
			if (chatResult.metadata?.actions) {
				this.actions.splice(
					0,
					this.actions.length,
					...mergeActions(this.actions, chatResult.metadata.actions),
				);
			}
			this.parts = chatResult.parts ?? accumulator.toParts();
			this.keepToolCalls(chatResult.metadata?.tool_calls);
			// Notify with the final cited content
			callbacks?.onContent?.(this.content);
			callbacks?.onAction?.([...this.actions]);
			this.emitParts();
		}
		return true;
	}
}

export class ChatService {
	private static instance: ChatService;
	private activeJobs = new Map<string, AbortController>();

	private constructor() {}

	static getInstance(): ChatService {
		if (!ChatService.instance) {
			ChatService.instance = new ChatService();
		}
		return ChatService.instance;
	}

	/**
	 * Execute a chat request with streaming
	 */
	async chatStream(
		options: ChatServiceOptions,
		callbacks?: ChatStreamCallbacks,
		signal?: AbortSignal,
	): Promise<ChatStreamResult> {
		const {
			messages,
			model,
			mode,
			topicId,
			agentFlowId,
			flowConfig,
			flowConfigPrefix,
			streamConfig,
			tools,
			tool_choice,
			parallel_tool_calls,
			conversation,
			reminders,
		} = options;

		const abortController = new AbortController();
		const jobId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Store abort controller for cleanup
		this.activeJobs.set(jobId, abortController);

		try {
			// Stopped before it started: there is no run to end or to keep.
			if (signal?.aborted) {
				throw new DOMException(ABORT_ERROR_MESSAGE, "AbortError");
			}
			// Handle external abort signal
			if (signal) {
				signal.addEventListener("abort", () => {
					abortController.abort();
					this.activeJobs.delete(jobId);
				});
			}

			// Execute chat job with streaming
			const result = await backgroundJob.execute(
				"chat",
				{
					messages,
					model,
					mode,
					topicId,
					agentFlowId,
					flowConfig,
					flowConfigPrefix,
					tools,
					tool_choice,
					parallel_tool_calls,
					conversation,
					...(reminders?.length ? { reminders } : {}),
					streamConfig: streamConfig || {
						minWordsToStream: 1,
						streamToolCallsImmediately: true,
					},
				},
				{ stream: true },
			);

			const reader = new ChatProgressReader(callbacks);

			if (!("stream" in result)) {
				return {
					content: "",
					contentParts: [],
					actions: [],
					failed: true,
					error: "Chat request failed",
				};
			}
			callbacks?.onRunStarted?.(result.jobId);

			// Stopping ends the run where it runs, not just this reader: the agent
			// loop must not go on in the background. The run then reports back like
			// a finished one, so its message keeps its tokens, steps and tool calls.
			let detach!: () => void;
			const detached = new Promise<typeof DETACHED>((resolve) => {
				detach = () => resolve(DETACHED);
			});
			let graceTimer: ReturnType<typeof setTimeout> | undefined;
			const stopRun = () => {
				requestRunStop(result.jobId);
				graceTimer = setTimeout(detach, STOP_GRACE_MS);
			};
			if (abortController.signal.aborted) {
				stopRun();
			} else {
				abortController.signal.addEventListener("abort", stopRun, {
					once: true,
				});
			}

			// Process streaming results
			const progressEvents = result.stream[Symbol.asyncIterator]();
			try {
				while (true) {
					const next = await Promise.race([progressEvents.next(), detached]);
					if (next === DETACHED) {
						void progressEvents.return?.();
						break;
					}
					if (next.done) break;
					if (!reader.read(next.value)) break;
				}
			} finally {
				clearTimeout(graceTimer);
				abortController.signal.removeEventListener("abort", stopRun);
			}

			// Return result
			return {
				content: reader.content,
				contentParts: [],
				parts: reader.partsSoFar,
				actions: reader.actions,
				toolCalls: reader.toolCalls,
				failed: reader.failed,
				error: reader.failed ? reader.error : undefined,
				errorMetadata: reader.failed ? reader.errorMetadata : undefined,
				metadata: reader.metadata,
				usage: reader.usage,
				stopped: abortController.signal.aborted,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown chat error";
			callbacks?.onError?.(errorMessage);
			throw error;
		} finally {
			this.activeJobs.delete(jobId);
		}
	}

	/**
	 * Hand a message to a run in progress; the agent reads it before its next
	 * request. False when the run is already over (or cannot take messages):
	 * the caller then sends it as a new message.
	 */
	async injectMessage(
		jobId: string,
		message: InjectedMessage,
	): Promise<boolean> {
		try {
			const execution = await backgroundJob.execute(
				"inject-chat-message",
				{ targetJobId: jobId, message },
				{ stream: false },
			);
			if (!("promise" in execution)) return false;
			const outcome = await execution.promise;
			const result = (outcome as { result?: { accepted?: unknown } }).result;
			return result?.accepted === true;
		} catch {
			return false;
		}
	}

	/**
	 * The chat runs in flight wherever they were started, this page or not
	 * (the co-agent answering on a web page). Empty when it cannot be asked.
	 */
	async listRuns(): Promise<ChatRunInfo[]> {
		try {
			const execution = await backgroundJob.execute(
				"list-chat-runs",
				{},
				{ stream: false },
			);
			if (!("promise" in execution)) return [];
			const outcome = await execution.promise;
			const runs = (outcome as { result?: { runs?: unknown } }).result?.runs;
			return Array.isArray(runs) ? (runs as ChatRunInfo[]) : [];
		} catch {
			return [];
		}
	}

	/** Stops a run by its job, whichever page started it. */
	stopRun(jobId: string): void {
		requestRunStop(jobId);
	}

	/**
	 * Stop all active chat requests
	 */
	stopAll(): void {
		for (const [jobId, controller] of this.activeJobs) {
			controller.abort();
		}
		this.activeJobs.clear();
	}

	/**
	 * Stop a specific chat request
	 */
	stop(jobId: string): void {
		const controller = this.activeJobs.get(jobId);
		if (controller) {
			controller.abort();
			this.activeJobs.delete(jobId);
		}
	}
}

export const chatService = ChatService.getInstance();
