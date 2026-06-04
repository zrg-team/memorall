import { backgroundJob } from "@/services/background-jobs/background-job";
import type { ChatMessage } from "./types";
import type {
	ChatResult,
	ChatPayload,
} from "@/services/background-jobs/handlers/process-chat";
import type { UnifiedFlowConfig } from "@/services/flows-core/interfaces/config/flow-config";
import type {
	ChatCompletionChunkToolCall,
	ChatCompletionMessageToolCall,
} from "@/types/openai";
import type {
	ComplexContent,
	ConversationContext,
	MessageParts,
} from "@/types/chat";
import { MessagePartsAccumulator } from "@/services/chat/message-parts";

export interface ChatServiceOptions {
	messages: ChatMessage[];
	model: string;
	mode: "normal" | "agent" | "custom";
	topicId?: string;
	agentFlowId?: string;
	flowConfig?: UnifiedFlowConfig;
	flowConfigPrefix?: UnifiedFlowConfig;
	systemMessages?: string[];
	conversation?: ConversationContext;
}

export interface ChatAction {
	id: string;
	name: string;
	description: string;
	metadata: Record<string, unknown>;
}

export interface ChatResponse {
	content: string;
	role: "assistant";
	metadata?: {
		actions?: ChatAction[];
		tool_calls?: ChatCompletionMessageToolCall[];
	};
}

export interface ChatStreamOptions extends ChatServiceOptions {
	onProgress?: (content: string, isComplete: boolean) => void;
	onParts?: (parts: MessageParts) => void;
	onContentParts?: (parts: ComplexContent) => void;
	onAction?: (actions: ChatAction[]) => void;
	onToolCalls?: (toolCalls: ChatCompletionMessageToolCall[]) => void;
	onExecuteStart?: (event: {
		node: string;
		metadata?: Record<string, unknown>;
	}) => void;
	onError?: (error: string) => void;
	signal?: AbortSignal;
}

export interface EmbeddedChatStreamResult {
	content: string;
	contentParts: ComplexContent;
	parts?: MessageParts;
	actions: ChatAction[];
	toolCalls?: ChatCompletionMessageToolCall[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	failed?: boolean;
	error?: string;
}

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

type ToolCallAccumulator = Map<
	number,
	{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}
>;

const accumulateChunkToolCalls = (
	accumulator: ToolCallAccumulator,
	toolCalls: ChatCompletionChunkToolCall[] | undefined,
): void => {
	if (!toolCalls?.length) {
		return;
	}

	for (const toolCall of toolCalls) {
		const existing = accumulator.get(toolCall.index);
		if (existing) {
			if (toolCall.function?.name) {
				existing.function.name = toolCall.function.name;
			}
			if (toolCall.function?.arguments) {
				existing.function.arguments += toolCall.function.arguments;
			}
			if (toolCall.id) {
				existing.id = toolCall.id;
			}
			continue;
		}

		accumulator.set(toolCall.index, {
			id: toolCall.id || `call_${toolCall.index}_${Date.now()}`,
			type: "function",
			function: {
				name: toolCall.function?.name || "",
				arguments: toolCall.function?.arguments || "",
			},
		});
	}
};

const getAccumulatedToolCalls = (
	accumulator: ToolCallAccumulator,
): ChatCompletionMessageToolCall[] => Array.from(accumulator.values());

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isChatResult = (value: unknown): value is ChatResult =>
	isRecord(value) && typeof value.type === "string";

const extractChatResult = (value: unknown): ChatResult | undefined => {
	if (isChatResult(value)) {
		return value;
	}

	if (isRecord(value) && isChatResult(value.result)) {
		return value.result;
	}

	return undefined;
};

export class EmbeddedChatService {
	private static instance: EmbeddedChatService;
	private activeJobs = new Map<string, AbortController>();
	private lastMetadata?: {
		actions?: ChatAction[];
		tool_calls?: ChatCompletionMessageToolCall[];
	};

	private constructor() {}

	static getInstance(): EmbeddedChatService {
		if (!EmbeddedChatService.instance) {
			EmbeddedChatService.instance = new EmbeddedChatService();
		}
		return EmbeddedChatService.instance;
	}

	/**
	 * Send a chat request and get streaming response
	 */
	async chatStream(
		options: ChatStreamOptions,
	): Promise<EmbeddedChatStreamResult> {
		const {
			messages,
			model,
			mode,
			topicId,
			agentFlowId,
			flowConfig,
			flowConfigPrefix,
			systemMessages,
			conversation,
			onProgress,
			onParts,
			onAction,
			onToolCalls,
			onExecuteStart,
			onError,
			signal,
		} = options;

		// Convert embedded ChatMessage to OpenAI-compatible format
		// Note: Embedded messages only have user/assistant roles
		const jobMessages: ChatPayload["messages"] = messages.flatMap((msg) => {
			if (msg.role === "user") {
				return [{ role: "user" as const, content: msg.content }];
			}
			if (msg.parts?.length) {
				return msg.parts;
			}
			// Assistant messages
			return [
				{
					role: "assistant" as const,
					content: typeof msg.content === "string" ? msg.content : null,
				},
			];
		});
		const requestMessages: ChatPayload["messages"] = [
			...(systemMessages ?? [])
				.map((content) => content.trim())
				.filter(Boolean)
				.map((content) => ({ role: "system" as const, content })),
			...jobMessages,
		];

		const abortController = new AbortController();
		const jobId = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

		// Store abort controller for cleanup
		this.activeJobs.set(jobId, abortController);

		try {
			// Handle external abort signal
			if (signal) {
				signal.addEventListener("abort", () => {
					abortController.abort();
					this.activeJobs.delete(jobId);
				});
			}

			// Build simplified payload - let background service parse query from messages
			const payload: ChatPayload = {
				messages: requestMessages,
				model,
				mode,
				topicId,
				agentFlowId,
				flowConfig,
				flowConfigPrefix,
				conversation,
				streamConfig: {
					minWordsToStream: 5,
					streamToolCallsImmediately: true,
				},
			};

			// Execute chat job with streaming
			const result = await backgroundJob.execute("chat", payload, {
				stream: true,
			});

			let finalContent = "";
			let finalActions: ChatAction[] = [];
			const toolCallAccumulator: ToolCallAccumulator = new Map();
			const messagePartsAccumulator = new MessagePartsAccumulator();
			let finalToolCalls: ChatCompletionMessageToolCall[] = [];
			let finalUsage: EmbeddedChatStreamResult["usage"];
			let finalParts: MessageParts | undefined;

			if (!("stream" in result)) {
				throw new Error("WRONG OUPUT");
			}
			// Process streaming results
			for await (const progress of result.stream) {
				if (abortController.signal.aborted) {
					break;
				}

				if (progress.status === "failed") {
					const error = progress.error || "Chat request failed";
					onError?.(error);
					throw new Error(error);
				}

				if (progress.status === "completed" && progress.result) {
					const chatResult = extractChatResult(progress.result);
					if (chatResult?.type === "final") {
						finalParts = chatResult.parts ?? finalParts;
						finalContent = chatResult.content || finalContent;
						if (finalParts) {
							onParts?.(finalParts);
						}

						if (chatResult.metadata?.actions) {
							finalActions = mergeActions(
								finalActions,
								chatResult.metadata.actions,
							);
							onAction?.([...finalActions]);
						}
						if (chatResult.metadata?.tool_calls) {
							finalToolCalls = chatResult.metadata.tool_calls;
							onToolCalls?.(finalToolCalls);
						}
						if (chatResult.metadata?.usage) {
							finalUsage = chatResult.metadata.usage;
						}
						onProgress?.(finalContent, true);
					}
					continue;
				}

				if (
					!["processing", "pending"].includes(progress.status) ||
					!progress.result
				) {
					continue;
				}

				const chatResult = extractChatResult(progress.result);
				if (!chatResult) {
					continue;
				}

				if (chatResult.type === "chunk" && chatResult.chunk) {
					messagePartsAccumulator.addChunk(chatResult.chunk);
					finalParts = messagePartsAccumulator.toParts();
					onParts?.(finalParts);

					const delta = chatResult.chunk.choices[0]?.delta;
					if (delta?.tool_calls?.length) {
						accumulateChunkToolCalls(toolCallAccumulator, delta.tool_calls);
						finalToolCalls = getAccumulatedToolCalls(toolCallAccumulator);
						onToolCalls?.(finalToolCalls);
					}

					const isToolResultChunk =
						delta?.role === "tool" || !!delta?.tool_call_id;
					const content = isToolResultChunk ? "" : delta?.content;
					if (content) {
						finalContent += content;
						onProgress?.(finalContent, false);
					}
				} else if (chatResult.type === "execute-start") {
					const event = {
						node: chatResult.node,
						metadata: chatResult.metadata,
					};
					onExecuteStart?.(event);
				} else if (chatResult.type === "action" && chatResult.actions) {
					finalActions = mergeActions(finalActions, chatResult.actions);
					onAction?.([...finalActions]);
				} else if (chatResult.type === "final") {
					finalParts = chatResult.parts ?? finalParts;
					finalContent = chatResult.content || finalContent;
					if (finalParts) {
						onParts?.(finalParts);
					}
					if (chatResult.metadata?.actions) {
						finalActions = mergeActions(
							finalActions,
							chatResult.metadata.actions,
						);
					}
					if (chatResult.metadata?.tool_calls) {
						finalToolCalls = chatResult.metadata.tool_calls;
						onToolCalls?.(finalToolCalls);
					}
					if (chatResult.metadata?.usage) {
						finalUsage = chatResult.metadata.usage;
					}
					onProgress?.(finalContent, false);
					onAction?.([...finalActions]);
				}
			}

			// Final progress update
			if (finalContent) {
				onProgress?.(finalContent, true);
			}

			// Store actions for later retrieval
			this.lastMetadata = {
				actions: finalActions,
				tool_calls: finalToolCalls,
			};

			return {
				content: finalContent,
				contentParts: [],
				parts: finalParts ?? messagePartsAccumulator.toParts(),
				actions: finalActions,
				toolCalls:
					finalToolCalls.length > 0
						? finalToolCalls
						: getAccumulatedToolCalls(toolCallAccumulator),
				usage: finalUsage,
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown chat error";
			onError?.(errorMessage);
			throw error;
		} finally {
			this.activeJobs.delete(jobId);
		}
	}

	/**
	 * Get the default model (first available LLM)
	 */
	async getDefaultModel(): Promise<string> {
		try {
			// For now, return a default model name
			// In a real implementation, you'd call the background service to get available models
			return "gpt-4.1";
		} catch (error) {
			throw new Error("No models available");
		}
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

export const embeddedChatService = EmbeddedChatService.getInstance();
