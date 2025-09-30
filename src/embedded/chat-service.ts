import { backgroundJob } from "@/services/background-jobs/background-job";
import type { ChatMessage } from "./types";
import type { ChatResult } from "@/services/background-jobs/offscreen-handlers/process-chat";

export interface ChatServiceOptions {
	messages: ChatMessage[];
	model: string;
	mode: "normal" | "agent" | "knowledge";
	topicId?: string;
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
	};
}

export interface ChatStreamOptions extends ChatServiceOptions {
	onProgress?: (content: string, isComplete: boolean) => void;
	onAction?: (actions: ChatAction[]) => void;
	onError?: (error: string) => void;
	signal?: AbortSignal;
}

export class EmbeddedChatService {
	private static instance: EmbeddedChatService;
	private activeJobs = new Map<string, AbortController>();
	private lastMetadata?: { actions?: ChatAction[] };

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
	async chatStream(options: ChatStreamOptions): Promise<string> {
		const {
			messages,
			model,
			mode,
			topicId,
			onProgress,
			onAction,
			onError,
			signal,
		} = options;

		// Convert embedded ChatMessage to background job format
		const jobMessages = messages.map((msg) => ({
			role: msg.role,
			content: msg.content,
		}));

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

			// Get the query from the last user message for knowledge mode (following use-chat.ts line 214)
			const lastUserMessage = messages
				.filter((msg) => msg.role === "user")
				.pop();
			const query = mode === "knowledge" ? lastUserMessage?.content : undefined;

			// Execute chat job with streaming
			const result = await backgroundJob.execute(
				"chat",
				{
					messages: jobMessages,
					model,
					mode,
					query,
					topicId,
				},
				{ stream: true },
			);

			let finalContent = "";
			let finalActions: ChatAction[] = [];

			// Process streaming results
			for await (const progress of result.stream) {
				if (abortController.signal.aborted) {
					break;
				}

				// Handle streaming progress updates with ChatResult types
				if (progress.status === "processing" && progress.result) {
					const chatResult = progress.result as ChatResult;

					if (chatResult.type === "chunk" && chatResult.chunk) {
						// Handle streaming content chunks
						const content = chatResult.chunk.choices[0]?.delta?.content;
						if (content) {
							finalContent += content;
							// Send real-time streaming update
							onProgress?.(finalContent, false);
						}
					} else if (chatResult.type === "action" && chatResult.actions) {
						// Handle action updates
						chatResult.actions.forEach((action) => {
							if (!finalActions.find((a) => a.id === action.id)) {
								finalActions.push(action);
							}
						});
						onAction?.(finalActions);
					}
				}

				// Handle completion
				if (progress.status === "completed" && progress.result) {
					const chatResult = progress.result as ChatResult;
					if (chatResult.type === "final") {
						// Use accumulated content if we have it, otherwise use final content
						if (finalContent) {
							// We've been streaming, just mark as complete
							onProgress?.(finalContent, true);
						} else {
							// No streaming happened, use final content
							finalContent = chatResult.content;
							onProgress?.(finalContent, true);
						}

						if (chatResult.metadata?.actions) {
							finalActions = chatResult.metadata.actions;
							onAction?.(finalActions);
						}
					}
				}

				if (progress.status === "failed") {
					const error = progress.error || "Chat request failed";
					onError?.(error);
					throw new Error(error);
				}
			}

			// Final progress update
			onProgress?.(finalContent, true);

			// Store actions for later retrieval
			this.lastMetadata = { actions: finalActions };

			return finalContent;
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
			return "gpt-3.5-turbo";
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
