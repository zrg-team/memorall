import { useState, useEffect } from "react";
import { serviceManager } from "@/services";
import { flowsService } from "@/services/flows/flows-service";
import type {
	ChatCompletionRequest,
	ChatCompletionChunk,
	ChatMessage,
} from "@/types/openai";
import { useChatStore } from "@/stores/chat";
import type { ChatStatus } from "ai";
import { logError, logInfo } from "@/utils/logger";

export type ChatMode = "normal" | "agent" | "knowledge";

export const useChat = (model: string) => {
	const [inputValue, setInputValue] = useState("");
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [chatMode, setChatMode] = useState<ChatMode>("knowledge");
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	const {
		messages,
		isLoading,
		addMessage,
		updateMessage,
		finalizeMessage,
		setLoading,
		ensureMainConversation,
	} = useChatStore();

	// Initialize conversation
	useEffect(() => {
		const initializeConversation = async () => {
			if (model) {
				try {
					await ensureMainConversation();
				} catch (error) {
					logError("Failed to initialize main conversation:", error);
				}
			}
		};

		initializeConversation();
	}, [model, ensureMainConversation]);

	// Stop current chat request
	const handleStop = () => {
		if (abortController) {
			abortController.abort();
			setAbortController(null);
			setLoading(false);
			setStatus("ready");
		}
	};

	// Insert a separator message
	const insertSeparator = async () => {
		if (isLoading) return;

		try {
			await addMessage({
				role: "system",
				content: "---",
				type: "separator",
				createdAt: new Date(),
			});
		} catch (error) {
			logError("Failed to insert separator:", error);
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!inputValue.trim() || isLoading || !model) return;

		const userMessageContent = inputValue.trim();
		setInputValue("");
		setStatus("submitted");
		setLoading(true);

		// Create abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		let assistantMessage: any = null;
		let currentContent = "";

		try {
			// Add user message to store and database
			const userMessage = await addMessage({
				role: "user",
				content: userMessageContent,
			});

			setStatus("streaming");

			// Find the latest separator index to only send messages after it
			const allMessages = [...messages, userMessage];
			const latestSeparatorIndex = allMessages.findLastIndex(
				(msg) => msg.type === "separator",
			);

			// Get messages after the latest separator (or all messages if no separator exists)
			const relevantMessages =
				latestSeparatorIndex >= 0
					? allMessages.slice(latestSeparatorIndex + 1)
					: allMessages;

			// Filter out separator messages and map to the required format
			const sendMessages = relevantMessages
				.filter((msg) => msg.type !== "separator")
				.map((msg) => ({
					role: msg.role as ChatMessage["role"],
					content: msg.content,
				}));

			if (chatMode === "agent") {
				// Use SimpleGraph for agent mode
				const graph = flowsService.createGraph("simple", {
					llm: serviceManager.llmService,
					embedding: serviceManager.embeddingService,
					database: serviceManager.databaseService,
				});

				// Create assistant message placeholder
				assistantMessage = await addMessage({
					role: "assistant",
					content: "",
				});

				try {
					const stream = await graph.stream(
						{
							messages: sendMessages,
							steps: [],
						},
						{
							callbacks: {
								onNewChunk: (chunk: ChatCompletionChunk) => {
									const content = chunk.choices[0]?.delta?.content;
									if (content) {
										currentContent += content;
										updateMessage(assistantMessage.id, {
											content: currentContent,
										});
									}
								},
							},
						},
					);

					const actions: {
						id: string;
						name: string;
						description: string;
						metadata: Record<string, any>;
					}[] = [];

					for await (const partial of stream) {
						logInfo("Graph partial output:", partial);
						const keys = Object.keys(partial);
						keys.forEach((key) => {
							const paratialValue = partial[key];
							if (
								"actions" in paratialValue &&
								Array.isArray(paratialValue.actions) &&
								paratialValue.actions?.length
							) {
								paratialValue.actions.forEach((action) => {
									if (!actions.find((a) => a.id === action.id)) {
										actions.push(action);
									}
								});
								updateMessage(assistantMessage.id, { metadata: { actions } });
							}
						});
					}

					// Update and finalize the assistant message
					updateMessage(assistantMessage.id, {
						content: currentContent,
						metadata: { actions },
					});
					await finalizeMessage(assistantMessage.id, {
						content: currentContent,
						metadata: { actions },
					});
				} catch (graphError) {
					logError("Graph execution error:", graphError);
					const errorContent =
						"Sorry, I encountered an error processing your request with agent mode.";
					updateMessage(assistantMessage.id, { content: errorContent });
					await finalizeMessage(assistantMessage.id, { content: errorContent });
				}
			} else if (chatMode === "knowledge") {
				// Use KnowledgeRAGFlow for knowledge mode
				const graph = flowsService.createGraph("knowledge-rag", {
					llm: serviceManager.llmService,
					embedding: serviceManager.embeddingService,
					database: serviceManager.databaseService,
				});

				// Create assistant message placeholder
				assistantMessage = await addMessage({
					role: "assistant",
					content: "",
				});

				try {
					const stream = await graph.stream(
						{
							messages: sendMessages,
							query: userMessageContent,
							steps: [],
						},
						{
							callbacks: {
								onNewChunk: (chunk: ChatCompletionChunk) => {
									const content = chunk.choices[0]?.delta?.content;
									if (content) {
										currentContent += content;
										updateMessage(assistantMessage.id, {
											content: currentContent,
										});
									}
								},
							},
						},
					);

					const actions: {
						id: string;
						name: string;
						description: string;
						metadata: Record<string, any>;
					}[] = [];

					for await (const partial of stream) {
						logInfo("Knowledge RAG partial output:", partial);
						const keys = Object.keys(partial);
						keys.forEach((key) => {
							const partialValue = partial[key];
							if (
								"actions" in partialValue &&
								Array.isArray(partialValue.actions) &&
								partialValue.actions?.length
							) {
								partialValue.actions.forEach((action) => {
									if (!actions.find((a) => a.id === action.id)) {
										actions.push(action);
									}
								});
								updateMessage(assistantMessage.id, { metadata: { actions } });
							}
						});
					}

					// Update and finalize the assistant message
					updateMessage(assistantMessage.id, {
						content: currentContent,
						metadata: { actions },
					});
					await finalizeMessage(assistantMessage.id, {
						content: currentContent,
						metadata: { actions },
					});
				} catch (graphError) {
					logError("Knowledge RAG execution error:", graphError);
					const errorContent =
						"Sorry, I encountered an error processing your request with knowledge mode.";
					updateMessage(assistantMessage.id, { content: errorContent });
					await finalizeMessage(assistantMessage.id, { content: errorContent });
				}
			} else {
				const request: ChatCompletionRequest = {
					messages: sendMessages,
					model: model,
					max_tokens: 4096,
					temperature: 0.3,
					stream: true,
					signal: controller.signal,
				};

				// Create assistant message placeholder for streaming
				assistantMessage = await addMessage({
					role: "assistant",
					content: "",
				});

				try {
					if (request.stream) {
						// For streaming, the result should be an AsyncIterableIterator
						const stream = serviceManager.llmService.chatCompletions(
							request,
						) as AsyncIterableIterator<ChatCompletionChunk>;
						for await (const chunk of stream) {
							const content = chunk.choices[0]?.delta?.content;
							console.log("[Chat] content", content);
							if (content) {
								currentContent += content;
								// Update the message in real-time
								updateMessage(assistantMessage.id, { content: currentContent });
							}
						}
					}
				} catch (streamError) {
					throw streamError;
				}

				// Finalize message in database after streaming is complete
				if (currentContent) {
					await finalizeMessage(assistantMessage.id, {
						content: currentContent,
						metadata: { actions: [] },
					});
				}
			}

			setStatus("ready");
		} catch (error) {
			// Check if error is due to user aborting the request
			if (error instanceof Error && error.message === "Operation aborted") {
				logInfo("Chat request was stopped by user");
				setStatus("ready");

				// Save any partial content that was streamed before abort
				if (assistantMessage && currentContent) {
					try {
						await finalizeMessage(assistantMessage.id, {
							content: currentContent,
							metadata: { actions: [] },
						});
						logInfo("Saved partial content from stopped generation");
					} catch (saveError) {
						logError("Failed to save partial content:", saveError);
					}
				}

				return; // Don't show error message for user-initiated stops
			}

			logError("Chat error:", error);

			// Add error message to store and database
			await addMessage({
				role: "assistant",
				content: "Sorry, I encountered an error processing your message.",
			});

			setStatus("error");
		} finally {
			setLoading(false);
			setAbortController(null);
		}
	};

	return {
		inputValue,
		setInputValue,
		status,
		chatMode,
		setChatMode,
		messages,
		isLoading,
		abortController,
		handleSubmit,
		handleStop,
		insertSeparator,
	};
};
