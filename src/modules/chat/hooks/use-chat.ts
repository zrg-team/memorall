import { useState, useEffect } from "react";
import { chatService } from "@/modules/chat/services/chat-service";
import type { ChatMode } from "@/modules/chat/services/chat-service";
import type { ChatMessage } from "@/types/openai";
import { useChatStore } from "@/stores/chat";
import type { ChatStatus } from "ai";
import { logError, logInfo } from "@/utils/logger";

export interface InProgressMessage {
	id: string;
	content: string;
	actions: Array<{
		id: string;
		name: string;
		description: string;
		metadata: Record<string, unknown>;
	}>;
}

export const useChat = (model: string) => {
	const [inputValue, setInputValue] = useState("");
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [chatMode, setChatMode] = useState<ChatMode>("knowledge");
	const [selectedTopic, setSelectedTopic] = useState<string>("__all__");
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [inProgressMessage, setInProgressMessage] =
		useState<InProgressMessage | null>(null);

	const {
		messages,
		isLoading,
		addMessage,
		finalizeMessage,
		setLoading,
		ensureMainConversation,
		deleteMessages,
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

			// Create assistant message placeholder
			assistantMessage = await addMessage({
				role: "assistant",
				content: "",
			});

			// Set in-progress message for real-time updates
			setInProgressMessage({
				id: assistantMessage.id,
				content: "",
				actions: [],
			});

			// Execute chat via chat service
			const result = await chatService.chatStream(
				{
					messages: sendMessages,
					model: model,
					mode: chatMode,
					topicId:
						selectedTopic && selectedTopic !== "__all__"
							? selectedTopic
							: undefined,
					streamConfig: {
						minWordsToStream: 5,
						streamToolCallsImmediately: true,
					},
				},
				{
					onContent: (content) => {
						currentContent = content;
						// Only update in-progress message, not the store
						setInProgressMessage((prev) =>
							prev ? { ...prev, content } : null,
						);
					},
					onAction: (actions) => {
						// Only update in-progress message, not the store
						setInProgressMessage((prev) =>
							prev ? { ...prev, actions } : null,
						);
					},
					onError: (error) => {
						logError("Chat streaming error:", error);
					},
				},
				controller.signal,
			);

			// Handle completion or failure after stream finishes
			if (result.failed) {
				// Keep streamed content and append error message
				const errorContent = `${result.content}\n\n---\n\n❌ **Error:** ${result.error}`;
				await finalizeMessage(assistantMessage.id, {
					content: errorContent,
					metadata: { actions: result.actions },
				});
				throw new Error(result.error || "Chat failed");
			} else {
				// Success - finalize with current content and actions
				await finalizeMessage(assistantMessage.id, {
					content: result.content,
					metadata: { actions: result.actions },
				});
			}

			// Clear in-progress message
			setInProgressMessage(null);
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
							metadata: { actions: inProgressMessage?.actions || [] },
						});
						logInfo("Saved partial content from stopped generation");
					} catch (saveError) {
						logError("Failed to save partial content:", saveError);
					}
				}

				// Clear in-progress message
				setInProgressMessage(null);
				return; // Don't show error message for user-initiated stops
			}

			logError("Chat error:", error);

			// Update error message if assistant message exists, otherwise create new one
			if (assistantMessage) {
				const errorContent =
					"Sorry, I encountered an error processing your message.";
				await finalizeMessage(assistantMessage.id, { content: errorContent });
			} else {
				await addMessage({
					role: "assistant",
					content: "Sorry, I encountered an error processing your message.",
				});
			}

			// Clear in-progress message
			setInProgressMessage(null);
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
		selectedTopic,
		setSelectedTopic,
		messages,
		isLoading,
		abortController,
		inProgressMessage,
		handleSubmit,
		handleStop,
		insertSeparator,
		deleteMessages,
	};
};
