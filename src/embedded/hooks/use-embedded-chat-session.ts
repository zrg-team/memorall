import {
	useCallback,
	useEffect,
	useState,
	type Dispatch,
	type FormEvent,
	type FormEventHandler,
	type SetStateAction,
} from "react";
import { logError } from "@/utils/logger";
import { v4 } from "@/utils/uuid";
import { BACKGROUND_EVENTS } from "@/constants/events";
import { embeddedChatService } from "@/embedded/chat-service";
import { embeddedChatHistoryService } from "@/embedded/chat-history-service";
import { buildEmbeddedContextMessageContent } from "@/embedded/context-items";
import { createCoAgentFlowPrefixConfig } from "@/embedded/pages/CoAgent/co-agent-chat";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	ChatAction,
	ChatMessage,
	ChatModalProps,
	EmbeddedContextItem,
} from "@/embedded/types";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import type { Message } from "@/services/database/types";
import type { MessageParts } from "@/types/chat";

interface UseEmbeddedChatSessionOptions {
	context?: string;
	mode: NonNullable<ChatModalProps["mode"]>;
	pageTitle: string;
	pageUrl: string;
	inputValue: string;
	setInputValue: Dispatch<SetStateAction<string>>;
	attachedContexts: EmbeddedContextItem[];
	resetContexts: (showSection?: boolean) => void;
	modelAvailable: boolean;
	selectedModel: string;
	selectedAgentFlowId: string;
	coAgentEnabled: boolean;
	selectedTopic: string;
	scrollToBottom: (behavior?: ScrollBehavior) => void;
	setShouldAutoScroll: Dispatch<SetStateAction<boolean>>;
}

interface SubmitEmbeddedChatMessageOptions {
	event?: FormEvent<HTMLFormElement>;
	inputText: string;
	contextPrefix?: string;
	clearComposer: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parseStoredMessageParts = (value: unknown): MessageParts | null =>
	Array.isArray(value) ? (value as MessageParts) : null;

const mapStoredMessage = (message: Message): ChatMessage | null => {
	if (message.role !== "user" && message.role !== "assistant") {
		return null;
	}

	return {
		id: message.id,
		content: message.content,
		role: message.role,
		timestamp: new Date(message.createdAt),
		topicId: message.topicId,
		parts: parseStoredMessageParts(message.parts),
		metadata: isRecord(message.metadata) ? message.metadata : undefined,
	};
};

const cloneActions = (actions: ChatAction[] | undefined): ChatAction[] =>
	(actions ?? []).map((action) => ({
		...action,
		metadata: { ...action.metadata },
	}));

const getContentText = (content: ChatMessage["content"]): string => {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
};

const EMBEDDED_CHAT_FEATURE_STEP_NAME = "embedded-chat-feature";

const createEmbeddedChatFlowPrefixConfig = () => ({
	graphType: "foundation",
	steps: [
		{
			id: "runtime__embedded_chat_feature__1",
			name: EMBEDDED_CHAT_FEATURE_STEP_NAME,
			enabled: true,
		},
	],
});

const getPageDescription = (): string => {
	const selectors = [
		'meta[name="description"]',
		'meta[property="og:description"]',
		'meta[name="twitter:description"]',
	];
	for (const selector of selectors) {
		const content = document
			.querySelector<HTMLMetaElement>(selector)
			?.content?.trim();
		if (content) return content;
	}
	return "";
};

const renderEmbeddedPageContextSystemMessage = ({
	pageTitle,
	pageUrl,
}: {
	pageTitle: string;
	pageUrl: string;
}): string =>
	`
Current browser page for EmbeddedChat:
- URL: ${pageUrl || "Unknown"}
- Title: ${pageTitle || document.title || "Unknown"}
- Description: ${getPageDescription() || "Not available"}

Use this as lightweight page orientation. Prefer the user's attached context when present, and use current-page tools only when more live page evidence is needed.
`.trim();

const ensureEmbeddedChatToolTarget = async (): Promise<void> => {
	try {
		await chrome.runtime.sendMessage({
			type: BACKGROUND_EVENTS.CO_AGENT_SET_ACTIVE,
			url: window.location.href,
		});
	} catch (error) {
		logError("[EMBEDDED_CHAT] Failed to set active tool target:", error);
	}
};

export const useEmbeddedChatSession = ({
	context,
	mode,
	pageTitle,
	pageUrl,
	inputValue,
	setInputValue,
	attachedContexts,
	resetContexts,
	modelAvailable,
	selectedModel,
	selectedAgentFlowId,
	coAgentEnabled,
	selectedTopic,
	scrollToBottom,
	setShouldAutoScroll,
}: UseEmbeddedChatSessionOptions) => {
	const t = useEmbeddedTranslation("chat");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isTyping, setIsTyping] = useState(false);
	const [isLoadingHistory, setIsLoadingHistory] = useState(true);
	const [, setStreamingMessageId] = useState<string | null>(null);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);

	useEffect(() => {
		let cancelled = false;

		const loadStoredMessages = async () => {
			try {
				const storedMessages = await embeddedChatHistoryService.loadMessages();
				if (cancelled) {
					return;
				}
				setMessages(
					storedMessages
						.map(mapStoredMessage)
						.filter((message): message is ChatMessage => Boolean(message)),
				);
			} catch (error) {
				logError("Failed to load embedded chat history:", error);
			} finally {
				if (!cancelled) {
					setIsLoadingHistory(false);
				}
			}
		};

		void loadStoredMessages();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!context) return;

		const autoQuery =
			mode === "topic"
				? `${t("tellMeAboutTopics")} ${context}`
				: `${t("whatDoYouKnow")} ${context}`;
		setInputValue(autoQuery);
	}, [context, mode, setInputValue, t]);

	const stop = useCallback(() => {
		if (abortController) {
			abortController.abort();
			setAbortController(null);
			setIsTyping(false);
			setStreamingMessageId(null);
		}
	}, [abortController]);

	const newChat = useCallback(async () => {
		if (isTyping) return;

		setMessages([]);
		setInputValue("");
		resetContexts(false);

		try {
			await embeddedChatHistoryService.insertSeparator();
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
			logError("Failed to start a new embedded chat:", error);
		}
	}, [isTyping, resetContexts, setInputValue]);

	const deleteChat = useCallback(() => {
		void newChat();
	}, [newChat]);

	const submitMessage = useCallback(
		async ({
			event,
			inputText,
			contextPrefix,
			clearComposer,
		}: SubmitEmbeddedChatMessageOptions) => {
			event?.preventDefault();

			if (!inputText.trim() || isTyping || !modelAvailable) {
				return;
			}

			const userMessageContent = inputText.trim();
			const effectiveUserMessageContent = contextPrefix
				? `${contextPrefix}\n\n---\n\n${userMessageContent}`
				: userMessageContent;
			const composedUserContent = buildEmbeddedContextMessageContent({
				userMessage: effectiveUserMessageContent,
				contexts: attachedContexts,
				pageTitle,
				pageUrl,
			});

			if (clearComposer) {
				setInputValue("");
			}
			resetContexts();
			setIsTyping(true);
			setShouldAutoScroll(true);

			const controller = new AbortController();
			setAbortController(controller);

			const userMessageId = v4();
			let assistantMessageId = v4();
			let currentContent = "";
			let latestActions: ChatAction[] = [];
			let latestToolCalls: unknown[] = [];
			let latestParts: MessageParts | undefined;

			try {
				const topicId =
					selectedTopic &&
					selectedTopic !== "default" &&
					selectedTopic !== "__all__"
						? selectedTopic
						: undefined;

				const userMessageForUI: ChatMessage = {
					id: userMessageId,
					content: composedUserContent,
					role: "user",
					timestamp: new Date(),
					topicId,
				};
				const assistantMessage: ChatMessage = {
					id: assistantMessageId,
					content: "",
					role: "assistant",
					timestamp: new Date(),
					topicId,
					isStreaming: true,
					metadata: {},
				};
				setMessages((prev) => [...prev, userMessageForUI, assistantMessage]);
				setStreamingMessageId(assistantMessageId);

				const storedUserMessage = await embeddedChatHistoryService.addMessage({
					id: userMessageId,
					content: getContentText(composedUserContent),
					role: "user",
					topicId,
				});
				const userMessage = mapStoredMessage(storedUserMessage);
				if (!userMessage) {
					throw new Error("Failed to persist embedded user message");
				}

				const storedAssistantMessage =
					await embeddedChatHistoryService.addMessage({
						id: assistantMessageId,
						content: "",
						role: "assistant",
						topicId,
					});
				assistantMessageId = storedAssistantMessage.id;

				const messagesForAPI = [
					...messages,
					{
						id: userMessage.id,
						content: userMessageForUI.content,
						role: userMessage.role,
						timestamp: userMessage.timestamp,
					},
				];
				const serviceMode = "custom";
				await ensureEmbeddedChatToolTarget();

				const result = await embeddedChatService.chatStream({
					messages: messagesForAPI,
					model: selectedModel,
					mode: serviceMode,
					topicId,
					agentFlowId:
						selectedAgentFlowId === "chat" ? undefined : selectedAgentFlowId,
					flowConfigPrefix: coAgentEnabled
						? createCoAgentFlowPrefixConfig()
						: createEmbeddedChatFlowPrefixConfig(),
					systemMessages: [
						renderEmbeddedPageContextSystemMessage({ pageTitle, pageUrl }),
					],
					conversation: {
						id: storedAssistantMessage.conversationId ?? "embedded",
						inProgressMessage: { id: assistantMessageId },
					},
					signal: controller.signal,
					onProgress: (content: string, isComplete: boolean) => {
						currentContent = content;
						setMessages((prev) =>
							prev.map((message) => {
								if (message.id === assistantMessageId) {
									return {
										...message,
										content,
										isStreaming: !isComplete,
									};
								}
								return message;
							}),
						);
					},
					onParts: (parts) => {
						latestParts = parts;
						setMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? {
											...message,
											parts,
										}
									: message,
							),
						);
					},
					onAction: (actions: ChatAction[]) => {
						latestActions = cloneActions(actions);
						setMessages((prev) =>
							prev.map((message) => {
								if (message.id === assistantMessageId) {
									return {
										...message,
										metadata: {
											...message.metadata,
											actions,
										},
									};
								}
								return message;
							}),
						);
					},
					onToolCalls: (toolCalls) => {
						latestToolCalls = toolCalls;
						setMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? {
											...message,
											metadata: {
												...message.metadata,
												tool_calls: toolCalls,
											},
										}
									: message,
							),
						);
					},
					onExecuteStart: (executeState) => {
						setMessages((prev) =>
							prev.map((message) =>
								message.id === assistantMessageId
									? {
											...message,
											metadata: {
												...message.metadata,
												executeState,
											},
										}
									: message,
							),
						);
					},
					onError: (error: string) => {
						logError("Chat error:", error);
						setMessages((prev) =>
							prev.map((message) => {
								if (message.id === assistantMessageId) {
									return {
										...message,
										content: t("errorMessage"),
										isStreaming: false,
									};
								}
								return message;
							}),
						);

						setIsTyping(false);
						setStreamingMessageId(null);
						setAbortController(null);
					},
				});

				currentContent = result.content || currentContent;
				latestParts = result.parts || latestParts;
				latestActions = cloneActions(result.actions || latestActions);
				latestToolCalls = result.toolCalls || latestToolCalls;
				setMessages((prev) =>
					prev.map((message) =>
						message.id === assistantMessageId
							? {
									...message,
									content: currentContent,
									parts: latestParts,
									isStreaming: false,
									metadata: {
										...message.metadata,
										actions: latestActions,
										tool_calls: latestToolCalls,
										model: selectedModel,
									},
								}
							: message,
					),
				);
			} catch (error) {
				logError("Chat submission error:", error);
				const errorContent = currentContent || t("errorMessage");
				setMessages((prev) =>
					prev.map((message) => {
						if (message.id === assistantMessageId) {
							return {
								...message,
								content: errorContent,
								parts: latestParts,
								isStreaming: false,
								metadata: {
									...message.metadata,
									actions: latestActions,
									tool_calls: latestToolCalls,
									model: selectedModel,
								},
							};
						}
						return message;
					}),
				);
			} finally {
				setIsTyping(false);
				setStreamingMessageId(null);
				setAbortController(null);
				setTimeout(() => scrollToBottom(), 100);
			}
		},
		[
			isTyping,
			modelAvailable,
			attachedContexts,
			pageTitle,
			pageUrl,
			setInputValue,
			resetContexts,
			setShouldAutoScroll,
			messages,
			selectedTopic,
			selectedAgentFlowId,
			coAgentEnabled,
			selectedModel,
			t,
			scrollToBottom,
		],
	);
	const submit: FormEventHandler<HTMLFormElement> = useCallback(
		(event) =>
			void submitMessage({
				event,
				inputText: inputValue,
				clearComposer: true,
			}),
		[inputValue, submitMessage],
	);

	return {
		messages,
		isTyping: isTyping || isLoadingHistory,
		submit,
		submitMessage,
		stop,
		deleteChat,
		newChat,
	};
};
