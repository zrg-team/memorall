import { BaseProcessHandler } from "./base-process-handler";
import type { ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { serviceManager } from "@/services";
import type {
	ChatCompletionRequest,
	ChatMessage,
	ChatCompletionChunk,
} from "@/types/openai";
import { handlerRegistry } from "./handler-registry";

export interface ChatStreamConfig {
	/** Minimum number of words to buffer before streaming (default: 5) */
	minWordsToStream?: number;
	/** Whether to stream tool calls immediately (default: true) */
	streamToolCallsImmediately?: boolean;
}

export interface ChatPayload {
	messages: ChatMessage[];
	model: string;
	mode: "normal" | "agent" | "knowledge";
	query?: string; // For knowledge mode
	topicId?: string; // For topic filtering in knowledge mode
	streamConfig?: ChatStreamConfig;
}

export type ChatResult =
	| {
			type: "chunk";
			chunk?: ChatCompletionChunk;
	  }
	| {
			type: "final";
			content: string;
			metadata?: {
				actions?: Array<{
					id: string;
					name: string;
					description: string;
					metadata: Record<string, any>;
				}>;
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

/**
 * Helper class to buffer streaming content and emit when threshold is reached
 */
class StreamBuffer {
	private buffer: string = "";
	private wordCount: number = 0;
	private readonly minWords: number;
	private onEmit: (content: string) => void;

	constructor(minWords: number, onEmit: (content: string) => void) {
		this.minWords = minWords;
		this.onEmit = onEmit;
	}

	/**
	 * Add content to buffer and emit if word threshold reached
	 */
	add(content: string): void {
		this.buffer += content;

		// Count words by splitting on whitespace
		const words = this.buffer.trim().split(/\s+/);
		this.wordCount = words.length;

		// Emit if we've reached the minimum word count
		if (this.wordCount >= this.minWords) {
			this.flush();
		}
	}

	/**
	 * Force emit all buffered content
	 */
	flush(): void {
		if (this.buffer) {
			this.onEmit(this.buffer);
			this.buffer = "";
			this.wordCount = 0;
		}
	}

	/**
	 * Get current buffer without flushing
	 */
	peek(): string {
		return this.buffer;
	}
}

export class ChatHandler extends BaseProcessHandler<ChatJob> {
	constructor() {
		super();
	}

	async process(
		jobId: string,
		job: ChatJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { messages, model, mode, query, topicId, streamConfig } = job.payload;

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
		const actions: Array<{
			id: string;
			name: string;
			description: string;
			metadata: Record<string, any>;
		}> = [];

		// Create stream buffer for content
		const streamBuffer = new StreamBuffer(
			config.minWordsToStream,
			(bufferedContent) => {
				currentContent += bufferedContent;
				// Emit buffered content as chunk
				dependencies.updateJobProgress(jobId, {
					stage: "Receiving response...",
					progress: Math.min(80, 20 + currentContent.length / 10),
					result: {
						type: "chunk",
						chunk: {
							id: `chunk-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: model,
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
			},
		);

		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				stage: "Initializing chat processing...",
				progress: 5,
			});

			if (mode === "agent") {
				// Use SimpleGraph for agent mode (following use-chat.ts pattern)
				const graph = serviceManager.flowsService.createGraph("simple", {
					llm: serviceManager.llmService,
					embedding: serviceManager.embeddingService,
					database: serviceManager.databaseService,
				});

				await dependencies.updateJobProgress(jobId, {
					stage: "Processing with agent mode...",
					progress: 20,
				});

				const stream = await graph.stream(
					{
						messages: messages,
						steps: [],
					},
					{
						callbacks: {
							onNewChunk: async (chunk: ChatCompletionChunk) => {
								// Stream all chunk types immediately if it's a tool call
								const hasToolCalls =
									chunk.choices[0]?.delta &&
									"tool_calls" in chunk.choices[0]?.delta &&
									Array.isArray(chunk.choices[0]?.delta?.tool_calls) &&
									chunk.choices[0]?.delta?.tool_calls?.length > 0;
								if (hasToolCalls && config.streamToolCallsImmediately) {
									await dependencies.updateJobProgress(jobId, {
										stage: "Tool call in progress...",
										progress: Math.min(80, 20 + currentContent.length / 10),
										result: {
											type: "chunk",
											chunk,
										} as ChatResult,
									});
									return;
								}

								// Buffer content chunks
								const content = chunk.choices[0]?.delta?.content;
								if (content) {
									streamBuffer.add(content);
								}

								// Stream other chunk types immediately (role, finish_reason, etc)
								if (
									chunk.choices[0]?.delta?.role ||
									chunk.choices[0]?.finish_reason
								) {
									await dependencies.updateJobProgress(jobId, {
										stage: "Receiving response...",
										progress: Math.min(80, 20 + currentContent.length / 10),
										result: {
											type: "chunk",
											chunk,
										} as ChatResult,
									});
								}
							},
						},
					},
				);

				for await (const partial of stream) {
					const keys = Object.keys(partial);
					keys.forEach((key) => {
						const partialValue = partial[key];
						if (
							"actions" in partialValue &&
							Array.isArray(partialValue.actions) &&
							partialValue.actions?.length
						) {
							partialValue.actions.forEach((action: any) => {
								if (!actions.find((a) => a.id === action.id)) {
									actions.push(action);
								}
							});
							dependencies.updateJobProgress(jobId, {
								stage: "Receiving response...",
								progress: 10,
								result: {
									type: "action",
									actions,
								} as ChatResult,
							});
						}
					});
				}

				// Flush any remaining buffered content
				streamBuffer.flush();
			} else if (mode === "knowledge") {
				// Use KnowledgeRAGFlow for knowledge mode (following use-chat.ts pattern)
				const graph = serviceManager.flowsService.createGraph("knowledge-rag", {
					llm: serviceManager.llmService,
					embedding: serviceManager.embeddingService,
					database: serviceManager.databaseService,
				});

				await dependencies.updateJobProgress(jobId, {
					stage: "Searching knowledge base...",
					progress: 20,
				});

				const stream = await graph.stream(
					{
						messages: messages,
						query: query || messages[messages.length - 1]?.content || "",
						topicId: topicId,
						steps: [],
					},
					{
						callbacks: {
							onNewChunk: async (chunk: ChatCompletionChunk) => {
								// Stream all chunk types immediately if it's a tool call
								const hasToolCalls =
									chunk.choices[0]?.delta &&
									"tool_calls" in chunk.choices[0]?.delta &&
									Array.isArray(chunk.choices[0]?.delta?.tool_calls) &&
									chunk.choices[0]?.delta?.tool_calls?.length > 0;
								if (hasToolCalls && config.streamToolCallsImmediately) {
									await dependencies.updateJobProgress(jobId, {
										stage: "Tool call in progress...",
										progress: Math.min(80, 20 + currentContent.length / 10),
										result: {
											type: "chunk",
											chunk,
										} as ChatResult,
									});
									return;
								}

								// Buffer content chunks
								const content = chunk.choices[0]?.delta?.content;
								if (content) {
									streamBuffer.add(content);
								}

								// Stream other chunk types immediately (role, finish_reason, etc)
								if (
									chunk.choices[0]?.delta?.role ||
									chunk.choices[0]?.finish_reason
								) {
									await dependencies.updateJobProgress(jobId, {
										stage: "Receiving response...",
										progress: Math.min(80, 20 + currentContent.length / 10),
										result: {
											type: "chunk",
											chunk,
										} as ChatResult,
									});
								}
							},
						},
					},
				);

				for await (const partial of stream) {
					const keys = Object.keys(partial);
					keys.forEach((key) => {
						const partialValue = partial[key];
						if (
							"actions" in partialValue &&
							Array.isArray(partialValue.actions) &&
							partialValue.actions?.length
						) {
							partialValue.actions.forEach((action: any) => {
								if (!actions.find((a) => a.id === action.id)) {
									actions.push(action);
								}
							});
							dependencies.updateJobProgress(jobId, {
								stage: "Receiving response...",
								progress: 10,
								result: {
									type: "action",
									actions,
								} as ChatResult,
							});
						}
					});
				}

				// Flush any remaining buffered content
				streamBuffer.flush();
			} else {
				// Normal mode - direct LLM call (following use-chat.ts pattern exactly)
				const request: ChatCompletionRequest = {
					messages: messages,
					model: model,
					max_tokens: 4096,
					temperature: 0.3,
					stream: true,
				};

				await dependencies.updateJobProgress(jobId, {
					stage: "Sending request to LLM...",
					progress: 20,
				});

				try {
					// Use the exact same pattern from use-chat.ts lines 294-304
					if (request.stream) {
						// For streaming, the result should be an AsyncIterableIterator
						const stream = serviceManager.llmService.chatCompletions(
							request,
						) as AsyncIterableIterator<ChatCompletionChunk>;

						for await (const chunk of stream) {
							// Stream all chunk types immediately if it's a tool call
							const hasToolCalls =
								chunk.choices[0]?.delta &&
								"tool_calls" in chunk.choices[0]?.delta &&
								Array.isArray(chunk.choices[0]?.delta?.tool_calls) &&
								chunk.choices[0]?.delta?.tool_calls?.length > 0;
							if (hasToolCalls && config.streamToolCallsImmediately) {
								await dependencies.updateJobProgress(jobId, {
									stage: "Tool call in progress...",
									progress: Math.min(80, 20 + currentContent.length / 10),
									result: {
										type: "chunk",
										chunk,
									} as ChatResult,
								});
								continue;
							}

							// Buffer content chunks
							const content = chunk.choices[0]?.delta?.content;
							if (content) {
								streamBuffer.add(content);
							}

							// Stream other chunk types immediately (role, finish_reason, etc)
							if (
								chunk.choices[0]?.delta?.role ||
								chunk.choices[0]?.finish_reason
							) {
								await dependencies.updateJobProgress(jobId, {
									stage: "Receiving response...",
									progress: Math.min(80, 20 + currentContent.length / 10),
									result: {
										type: "chunk",
										chunk,
									} as ChatResult,
								});
							}
						}
					}
				} catch (streamError) {
					throw streamError;
				}

				// Flush any remaining buffered content
				streamBuffer.flush();
			}

			return {
				type: "final",
				content: currentContent,
				metadata: { actions },
			};
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			await dependencies.logger.error(
				`❌ Chat job ${jobId} failed`,
				error,
				"offscreen",
			);

			await dependencies.updateJobProgress(jobId, {
				stage: "Chat failed",
				progress: 100,
				error: errorMessage,
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
