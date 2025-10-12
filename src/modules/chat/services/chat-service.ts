import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	ChatResult,
	ChatStreamConfig,
} from "@/services/background-jobs/handlers/process-chat";
import type { ChatMessage } from "@/types/openai";

export type ChatMode = "normal" | "knowledge";

export interface ChatServiceOptions {
	messages: ChatMessage[];
	model: string;
	mode: ChatMode;
	topicId?: string;
	streamConfig?: ChatStreamConfig;
}

export interface ChatAction {
	id: string;
	name: string;
	description: string;
	metadata: Record<string, unknown>;
}

export interface ChatStreamCallbacks {
	onContent?: (content: string) => void;
	onAction?: (actions: ChatAction[]) => void;
	onError?: (error: string) => void;
}

export interface ChatStreamResult {
	content: string;
	actions: ChatAction[];
	failed: boolean;
	error?: string;
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
		const { messages, model, mode, topicId, streamConfig } = options;

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

			// Get the query from the last user message for knowledge mode
			const lastUserMessage = messages
				.filter((msg) => msg.role === "user")
				.pop();
			const query = mode === "knowledge" ? lastUserMessage?.content : undefined;

			// Execute chat job with streaming
			const result = await backgroundJob.execute(
				"chat",
				{
					messages,
					model,
					mode,
					query,
					topicId,
					streamConfig: streamConfig || {
						minWordsToStream: 5,
						streamToolCallsImmediately: true,
					},
				},
				{ stream: true },
			);

			let currentContent = "";
			const actions: ChatAction[] = [];
			let streamFailed = false;
			let streamError = "";

			// Process streaming results
			for await (const progress of result.stream) {
				if (abortController.signal.aborted) {
					break;
				}

				// Handle failure
				if (progress.status === "failed") {
					streamFailed = true;
					streamError = progress.error || "Chat request failed";
					callbacks?.onError?.(streamError);
					break;
				}

				// Handle completion - get final content
				if (progress.status === "completed" && progress.result) {
					const chatResult = progress.result as ChatResult;
					if (chatResult.type === "final") {
						// Use the final content from the job result
						currentContent = chatResult.content;
						if (chatResult.metadata?.actions) {
							chatResult.metadata.actions.forEach((action) => {
								if (!actions.find((a) => a.id === action.id)) {
									actions.push(action);
								}
							});
						}
					}
				}

				// Process streaming updates
				if (
					["processing", "pending"].includes(progress.status) &&
					progress.result
				) {
					const chatResult = progress.result as ChatResult;

					if (chatResult.type === "chunk" && chatResult.chunk) {
						// Handle streaming content chunks
						const content = chatResult.chunk.choices[0]?.delta?.content;
						if (content) {
							currentContent += content;
							callbacks?.onContent?.(currentContent);
						}
					} else if (chatResult.type === "action" && chatResult.actions) {
						// Handle action updates
						chatResult.actions.forEach((action) => {
							if (!actions.find((a) => a.id === action.id)) {
								actions.push(action);
							}
						});
						callbacks?.onAction?.(actions);
					}
				}
			}

			// Return result
			return {
				content: currentContent,
				actions,
				failed: streamFailed,
				error: streamFailed ? streamError : undefined,
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
