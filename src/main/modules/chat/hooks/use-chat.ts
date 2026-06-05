import { useState, useEffect } from "react";
import { chatService } from "@/main/modules/chat/services/chat-service";
import type { ChatMessage } from "@/types/openai";
import { useChatStore } from "@/main/stores/chat";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import type {
	ChatStatus,
	ComplexContent,
	AttachedDocumentRef,
	AssistantExecutionPart,
	MessageParts,
} from "@/types/chat";
import { logError, logInfo } from "@/utils/logger";
import { serviceManager } from "@/services";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { Message } from "@/services/database";
import { buildSendMessages } from "@/main/modules/chat/utils/build-send-messages";
import {
	trimToContextBudget,
	CONTEXT_BUDGET_RATIO,
} from "@/main/modules/chat/utils/context-manager";
import { estimatePromptTokens } from "@/services/llm/utils/token-usage";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import { createJobErrorMetadata } from "@/services/background-jobs/handlers/error-metadata";
import {
	extractDocumentText,
	formatDocumentBlock,
} from "@/main/modules/chat/utils/extract-document-text";
import { cloneMessageParts } from "@/services/chat/message-parts";
import { isAbortError } from "@/utils/abort";

export interface InProgressMessage {
	id: string;
	content: string;
	complexContent: ComplexContent | null;
	parts: MessageParts | null;
	actions: Array<{
		id: string;
		name: string;
		description: string;
		metadata: Record<string, unknown>;
	}>;
	executeState?: {
		node: string;
		metadata?: Record<string, unknown>;
	};
	executions?: AssistantExecutionPart[];
}

const cloneActions = (
	actions: InProgressMessage["actions"],
): InProgressMessage["actions"] =>
	actions.map((action) => ({
		...action,
		metadata: { ...action.metadata },
	}));

const cloneComplexContent = (
	complexContent: ComplexContent | null | undefined,
): ComplexContent | null =>
	complexContent ? complexContent.map((part) => ({ ...part })) : null;

const pickResultMetadata = (
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> => {
	if (!metadata) return {};

	const allowedKeys = [
		"provider",
		"timeToAnswer",
		"tokensPerSecond",
		"estimatedTokens",
		"usage",
		"executions",
	] as const;

	return Object.fromEntries(
		allowedKeys
			.filter((key) => key in metadata)
			.map((key) => [key, metadata[key]]),
	);
};

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

const addStreamingExecution = (
	executions: AssistantExecutionPart[] | undefined,
	event: { node: string; metadata?: Record<string, unknown> },
): AssistantExecutionPart[] => {
	if (isToolExecution(event)) return executions ?? [];

	const completed = (executions ?? []).map((part) =>
		part.state === "running" ? { ...part, state: "complete" as const } : part,
	);
	const next: AssistantExecutionPart = {
		type: "execution",
		id: getExecutionPartId(event),
		node: event.node,
		metadata: event.metadata,
		state: "running",
	};
	const existingIndex = completed.findIndex((part) => part.id === next.id);
	if (existingIndex === -1) return [...completed, next];
	const copy = [...completed];
	copy[existingIndex] = next;
	return copy;
};

export const useChat = (model: string) => {
	const [inputValue, setInputValue] = useState("");
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	const [inProgressMessage, setInProgressMessage] =
		useState<InProgressMessage | null>(null);

	// State selectors - only re-render when specific value changes
	const messages = useChatStore((state) => state.messages);
	const messageGroups = useChatStore((state) => state.messageGroups);
	const isLoading = useChatStore((state) => state.isLoading);
	const selectedTopic = useChatStore((state) => state.selectedTopic);
	const selectedAgentFlowId = useChatStore(
		(state) => state.selectedAgentFlowId,
	);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const availableAgents = useAgentConfigStore((state) => state.availableAgents);
	const agentFlowName = availableAgents.find(
		(a) => a.id === selectedAgentFlowId,
	)?.name;

	// Action selectors - stable references, won't cause re-renders
	const setSelectedTopic = useChatStore((state) => state.setSelectedTopic);
	const setSelectedAgentFlowId = useChatStore(
		(state) => state.setSelectedAgentFlowId,
	);
	const addMessage = useChatStore((state) => state.addMessage);
	const updateMessage = useChatStore((state) => state.updateMessage);
	const setLoading = useChatStore((state) => state.setLoading);
	const ensureMainConversation = useChatStore(
		(state) => state.ensureMainConversation,
	);
	const loadMessageGroup = useChatStore((state) => state.loadMessageGroup);
	const deleteMessages = useChatStore((state) => state.deleteMessages);

	const isCustomMode =
		selectedAgentFlowId !== null && selectedAgentFlowId !== "chat";

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

	// Sync selectedTopic with last message's topic only if no topic has been selected yet
	useEffect(() => {
		if (!isCustomMode) return;
		if (selectedTopic !== "default") return;

		// Find the last user or assistant message (skip separators)
		const lastMessage = messages
			.filter((msg) => msg.type !== "separator")
			.findLast((msg) => msg.role === "user" || msg.role === "assistant");

		if (lastMessage?.topicId) {
			setSelectedTopic(lastMessage.topicId);
		}
	}, [messages, isCustomMode]);

	// Stop current chat request
	const handleStop = () => {
		if (abortController) {
			abortController.abort();
			setAbortController(null);
			setLoading(false);
			setStatus("ready");
		}
	};

	// Insert a separator message and reset sandbox container state
	const insertSeparator = async () => {
		if (isLoading) return;

		try {
			await addMessage({
				role: "system",
				content: "---",
				type: "separator",
				createdAt: new Date(),
			});

			// Reset sandbox container runtime in offscreen so the new conversation segment starts clean
			backgroundJob
				.execute(
					"sandbox-operation",
					{ operation: "runtime.reset" as const, payload: undefined },
					{ stream: false },
				)
				.catch((error) => {
					logError("Failed to reset sandbox container:", error);
				});
		} catch (error) {
			logError("Failed to insert separator:", error);
		}
	};

	const submitMessage = async ({
		e,
		inputText,
		attachedImages = [],
		attachedDocumentRefs = [],
		contextPrefix,
		clearComposer,
	}: {
		e?: React.FormEvent;
		inputText: string;
		attachedImages?: File[];
		attachedDocumentRefs?: AttachedDocumentRef[];
		contextPrefix?: string;
		clearComposer: boolean;
	}) => {
		e?.preventDefault();
		if (!inputText.trim() || isLoading || !model) return;

		const rawInput = inputText.trim();
		const userMessageContent = rawInput;
		const effectiveUserMessageContent = contextPrefix
			? `${contextPrefix}\n\n---\n\n${rawInput}`
			: rawInput;
		if (clearComposer) {
			setInputValue("");
		}
		setStatus("submitted");
		setLoading(true);

		// Create abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		let assistantMessage: Message | null = null;
		let currentContent = "";
		let currentComplexContent: ComplexContent | null = null;
		let currentParts: MessageParts | null = null;

		try {
			// Separate document refs by kind
			const imageRefs = attachedDocumentRefs.filter(
				(r) => r.docType === "image",
			);
			const docRefs = attachedDocumentRefs.filter((r) => r.docType !== "image");

			// Extract text from non-image document refs and prepend as formatted blocks
			let effectiveMessageContent = effectiveUserMessageContent;
			if (docRefs.length > 0) {
				const blocks = await Promise.all(
					docRefs.map(async (ref) => {
						try {
							const bytes = await documentFileSystemService.readFile(
								toDocumentsSandboxPath(ref.path),
							);
							const text = await extractDocumentText(ref.docType, bytes);
							return text ? formatDocumentBlock(ref.path, text) : null;
						} catch {
							return null;
						}
					}),
				);
				const validBlocks = blocks.filter(Boolean).join("\n");
				if (validBlocks) {
					effectiveMessageContent = validBlocks + "\n" + userMessageContent;
				}
			}

			// Upload new images and merge with image document refs to build complexContent
			let complexContent: ComplexContent | undefined;
			const imageParts: Array<{
				type: "image_url";
				image_url: {
					url: string;
					detail: "auto";
					mimeType: string;
				};
			}> = [];

			if (attachedImages.length > 0) {
				const uploaded = await Promise.all(
					attachedImages.map(async (file) => {
						const path = await documentFileSystemService.uploadChatImage(file);
						return {
							type: "image_url" as const,
							image_url: {
								url: path,
								detail: "auto" as const,
								mimeType: file.type,
							},
						};
					}),
				);
				imageParts.push(...uploaded);
			}

			if (imageRefs.length > 0) {
				imageParts.push(
					...imageRefs.map((ref) => ({
						type: "image_url" as const,
						image_url: {
							url: ref.path,
							detail: "auto" as const,
							mimeType: ref.mimeType,
						},
					})),
				);
			}

			const hasExpandedDocumentContent =
				effectiveMessageContent !== userMessageContent;

			if (imageParts.length > 0 || hasExpandedDocumentContent) {
				complexContent = [
					{ type: "text" as const, text: effectiveMessageContent },
					...imageParts,
				];
			}

			// Add user message to store and database
			const userMessage = await addMessage({
				role: "user",
				content: userMessageContent,
				complexContent: complexContent ?? null,
				metadata:
					docRefs.length > 0
						? {
								attachedDocuments: docRefs,
							}
						: undefined,
				// Include topicId when in custom mode with a selected topic
				topicId:
					isCustomMode &&
					selectedTopic &&
					selectedTopic !== "default" &&
					selectedTopic !== "__all__"
						? selectedTopic
						: undefined,
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

			// Build messages for the API, prefixing assistant messages with their stored actions
			// buildSendMessages is async because it resolves image paths to base64 data URIs
			let sendMessages: ChatMessage[] =
				await buildSendMessages(relevantMessages);

			// Trim input to CONTEXT_BUDGET_RATIO of the context window,
			// leaving headroom for the model's response.
			const maxModelTokens =
				await serviceManager.llmService.getMaxModelTokens(model);
			const tokenBudget = Math.floor(maxModelTokens * CONTEXT_BUDGET_RATIO);
			if (estimatePromptTokens(sendMessages) > tokenBudget) {
				sendMessages = trimToContextBudget(sendMessages, tokenBudget);
			}

			// Create assistant message placeholder
			assistantMessage = await addMessage({
				role: "assistant",
				content: "",
				// Use the same topicId as the user message for consistency
				topicId: userMessage.topicId,
			});

			// Set in-progress message for real-time updates
			setInProgressMessage({
				id: assistantMessage.id,
				content: "",
				complexContent: null,
				parts: null,
				actions: [],
			});

			// Execute chat via chat service
			const result = await chatService.chatStream(
				{
					messages: sendMessages,
					model: model,
					mode: isCustomMode ? "custom" : "normal",
					topicId:
						isCustomMode && selectedTopic && selectedTopic !== "__all__"
							? selectedTopic
							: undefined,
					agentFlowId: selectedAgentFlowId ?? undefined,
					conversation: {
						id: currentConversation?.id ?? userMessage.conversationId,
						inProgressMessage: { id: assistantMessage.id },
						agentFlowName: agentFlowName ?? undefined,
					},
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
					onContentParts: (parts) => {
						currentComplexContent = cloneComplexContent(parts);
						setInProgressMessage((prev) =>
							prev
								? {
										...prev,
										complexContent: currentComplexContent,
									}
								: null,
						);
					},
					onParts: (parts) => {
						currentParts = cloneMessageParts(parts);
						setInProgressMessage((prev) =>
							prev
								? {
										...prev,
										parts: currentParts,
									}
								: null,
						);
					},
					onAction: (actions) => {
						// Only update in-progress message, not the store
						setInProgressMessage((prev) =>
							prev
								? {
										...prev,
										actions: cloneActions(actions),
									}
								: null,
						);
					},
					onExecuteStart: (event) => {
						setInProgressMessage((prev) =>
							prev
								? {
										...prev,
										executeState: event,
										executions: addStreamingExecution(prev.executions, event),
									}
								: null,
						);
					},
					onError: (error) => {
						logError("Chat streaming error:", error);
					},
				},
				controller.signal,
			);

			const actionMetadata = {
				actions: result.actions,
			};
			const finalContent = result.parts?.length ? "" : result.content;
			const finalComplexContent = result.parts?.length
				? null
				: cloneComplexContent(result.contentParts);

			// Handle completion or failure after stream finishes
			if (result.failed) {
				const errorMessage =
					result.errorMetadata?.message || result.error || "Chat failed";
				const errorContent =
					finalContent ||
					"Sorry, I encountered an error processing your message.";
				updateMessage(assistantMessage.id, {
					content: errorContent,
					complexContent: finalComplexContent,
					parts: result.parts ?? null,
					metadata: {
						...pickResultMetadata(result.metadata),
						...actionMetadata,
						error: result.errorMetadata ?? {
							message: errorMessage,
							rawMessage: result.error || errorMessage,
						},
						model,
						...(agentFlowName && { agentFlowName }),
					},
				});
				setInProgressMessage(null);
				setStatus("error");
				return;
			} else {
				// Success - update in-progress message with final content before saving
				// This ensures smooth transition from streaming to final
				setInProgressMessage((prev) =>
					prev
						? {
								...prev,
								content: finalContent,
								complexContent: finalComplexContent,
								parts: result.parts ?? null,
								actions: cloneActions(result.actions),
							}
						: null,
				);

				// Small delay to let React render the updated content
				await new Promise((resolve) => setTimeout(resolve, 150));

				updateMessage(assistantMessage.id, {
					content: finalContent,
					complexContent: finalComplexContent,
					parts: result.parts ?? null,
					metadata: {
						...pickResultMetadata(result.metadata),
						...actionMetadata,
						model,
						...(agentFlowName && { agentFlowName }),
					},
				});
			}

			// Clear in-progress message
			setInProgressMessage(null);
			setStatus("ready");
		} catch (error) {
			// Check if error is due to user aborting the request
			if (isAbortError(error)) {
				logInfo("Chat request was stopped by user");
				setStatus("ready");

				// Save any partial content that was streamed before abort
				if (assistantMessage && currentContent) {
					const savedParts = currentParts as MessageParts | null;
					const hasSavedParts =
						Array.isArray(savedParts) && savedParts.length > 0;
					updateMessage(assistantMessage.id, {
						content: hasSavedParts ? "" : currentContent,
						complexContent: hasSavedParts
							? null
							: cloneComplexContent(currentComplexContent),
						parts: savedParts,
						metadata: {
							actions: inProgressMessage?.actions || [],
							...(agentFlowName && { agentFlowName }),
						},
					});
					logInfo("Saved partial content from stopped generation");
				}

				// Clear in-progress message
				setInProgressMessage(null);
				return; // Don't show error message for user-initiated stops
			}

			logError("Chat error:", error);
			const errorMetadata = createJobErrorMetadata(error);

			// Update error message if assistant message exists, otherwise create new one
			if (assistantMessage) {
				const errorContent =
					"Sorry, I encountered an error processing your message.";
				updateMessage(assistantMessage.id, {
					content: currentContent || errorContent,
					complexContent: cloneComplexContent(currentComplexContent),
					parts: currentParts,
					metadata: {
						error: errorMetadata,
						model,
						...(agentFlowName && { agentFlowName }),
					},
				});
			} else {
				await addMessage({
					role: "assistant",
					content: "Sorry, I encountered an error processing your message.",
					metadata: {
						error: errorMetadata,
						model,
						...(agentFlowName && { agentFlowName }),
					},
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

	const handleSubmit = async (
		e: React.FormEvent,
		attachedImages: File[] = [],
		attachedDocumentRefs: AttachedDocumentRef[] = [],
		contextPrefix?: string,
	) => {
		await submitMessage({
			e,
			inputText: inputValue,
			attachedImages,
			attachedDocumentRefs,
			contextPrefix,
			clearComposer: true,
		});
	};

	return {
		inputValue,
		setInputValue,
		status,
		chatMode: isCustomMode ? "custom" : "normal",
		setChatMode: () => undefined,
		selectedTopic,
		setSelectedTopic,
		selectedAgentFlowId,
		setSelectedAgentFlowId,
		messages,
		messageGroups,
		isLoading,
		abortController,
		inProgressMessage,
		submitMessage,
		handleSubmit,
		handleStop,
		insertSeparator,
		loadMessageGroup,
		deleteMessages,
	} as const;
};
