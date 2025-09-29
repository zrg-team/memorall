import { BaseProcessHandler } from "./base-process-handler";
import type {
	ProcessDependencies,
	BaseJob,
	ItemHandlerResult,
} from "./types";
import { serviceManager } from "@/services";
import { flowsService } from "@/services/flows/flows-service";
import type { ChatCompletionRequest, ChatMessage, ChatCompletionChunk } from "@/types/openai";
import { handlerRegistry } from "./handler-registry";

export interface ChatPayload {
	messages: ChatMessage[];
	model: string;
	mode: "normal" | "agent" | "knowledge";
	query?: string; // For knowledge mode
}

export interface ChatResult extends Record<string, unknown> {
	content: string;
	role: "assistant";
	metadata?: {
		actions?: Array<{
			id: string;
			name: string;
			description: string;
			metadata: Record<string, any>;
		}>;
	};
}

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"chat": ChatPayload;
	}

	interface JobResultRegistry {
		"chat": ChatResult;
	}
}

const JOB_NAMES = {
	chat: "chat",
} as const;

export type ChatJob = BaseJob & {
	jobType: typeof JOB_NAMES.chat;
	payload: ChatPayload;
};

export class ChatHandler extends BaseProcessHandler<ChatJob> {
	constructor() {
		super();
	}

	async process(
		jobId: string,
		job: ChatJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { messages, model, mode, query } = job.payload;

		await dependencies.logger.info(
			`🤖 Starting chat job: ${jobId}`,
			{
				messageCount: messages.length,
				model,
				mode,
			},
			"offscreen",
		);

		dependencies.updateStatus(`Processing chat with ${model}...`);

		let currentContent = "";
		const actions: Array<{
			id: string;
			name: string;
			description: string;
			metadata: Record<string, any>;
		}> = [];

		try {
			// Send initial progress update
			await dependencies.updateJobProgress(jobId, {
				stage: "Initializing chat processing...",
				progress: 5,
			});

			if (mode === "agent") {
				// Use SimpleGraph for agent mode (following use-chat.ts pattern)
				const graph = flowsService.createGraph("simple", {
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
								const content = chunk.choices[0]?.delta?.content;
								if (content) {
									currentContent += content;

									// Send streaming progress updates
									await dependencies.updateJobProgress(jobId, {
										stage: "Receiving response...",
										progress: Math.min(80, 20 + (currentContent.length / 10)),
										result: {
											content: currentContent,
											role: "assistant" as const,
											metadata: { actions },
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
						}
					});
				}

			} else if (mode === "knowledge") {
				// Use KnowledgeRAGFlow for knowledge mode (following use-chat.ts pattern)
				const graph = flowsService.createGraph("knowledge-rag", {
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
						steps: [],
					},
					{
						callbacks: {
							onNewChunk: async (chunk: ChatCompletionChunk) => {
								const content = chunk.choices[0]?.delta?.content;
								if (content) {
									currentContent += content;

									// Send streaming progress updates
									await dependencies.updateJobProgress(jobId, {
										stage: "Receiving response...",
										progress: Math.min(80, 20 + (currentContent.length / 10)),
										result: {
											content: currentContent,
											role: "assistant" as const,
											metadata: { actions },
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
						}
					});
				}

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
							const content = chunk.choices[0]?.delta?.content;
							if (content) {
								currentContent += content;

								// Send streaming progress updates
								await dependencies.updateJobProgress(jobId, {
									stage: "Receiving response...",
									progress: Math.min(80, 20 + (currentContent.length / 10)),
									result: {
										content: currentContent,
										role: "assistant" as const,
										metadata: { actions },
									} as ChatResult,
								});
							}
						}
					}
				} catch (streamError) {
					throw streamError;
				}
			}

			// Final result
			const result: ChatResult = {
				content: currentContent,
				role: "assistant",
				metadata: { actions },
			};

			await dependencies.updateJobProgress(jobId, {
				stage: "Chat completed",
				progress: 100,
				result,
			});

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
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