import {
	COAGENT_SESSION_END,
	isNonModelMessageType,
	shouldCloseCoAgentSession,
} from "@/services/chat/coagent-session";
import { useEffect, useRef, useState } from "react";
import { chatService } from "@/main/modules/chat/services/chat-service";
import { getAgentOpenUITheme } from "@/main/modules/chat/utils/agent-openui-theme";
import { buildSendMessages } from "@/main/modules/chat/utils/build-send-messages";
import {
	extractDocumentText,
	formatDocumentBlock,
} from "@/main/modules/chat/utils/extract-document-text";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import {
	type ChatRun,
	findBlockingRun,
	useChatStore,
} from "@/main/stores/chat";
import {
	type QueuedChatMessage,
	useChatMessageQueueStore,
} from "@/main/stores/chat-message-queue";
import { useWebChallengePromptStore } from "@/main/stores/web-challenge-prompts";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { createJobErrorMetadata } from "@/services/background-jobs/handlers/error-metadata";
import { cloneMessageParts } from "@/services/chat/message-parts";
import {
	finishRunningToolExecutions,
	upsertToolExecution,
} from "@/services/chat/tool-executions";
import type { Message } from "@/services/database";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { memonClient } from "@/services/memon/memon-client";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import type {
	AssistantExecutionPart,
	AttachedDocumentRef,
	ChatStatus,
	ComplexContent,
	MessageParts,
	ChatCompaction,
	ToolExecutionRecord,
} from "@/types/chat";
import type { ChatMessage } from "@/types/openai";
import { isAbortError } from "@/utils/abort";
import { logError, logInfo } from "@/utils/logger";
import { v4 } from "@/utils/uuid";
import { useFrameCoalescedState } from "./use-frame-coalesced-state";
import { createCoAgentFlowPrefixConfig } from "@/co-agent/flow-config";
import { useCoAgentActivationStore } from "@/main/stores/co-agent-activation";

export interface InProgressMessage {
	id: string;
	/** The chat the run belongs to; it is only shown there. */
	conversationId: string;
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
	toolExecutions?: ToolExecutionRecord[];
	/** Where the conversation was compacted so far in this reply. */
	compactions?: ChatCompaction[];
}

/** What the composer hands over: the text and what is attached to it. */
export interface ChatMessageDraft {
	text: string;
	images?: File[];
	documentRefs?: AttachedDocumentRef[];
	contextPrefix?: string;
}

export interface UseChatOptions {
	/** New runs may share the time with runs in other chats (`ChatRun.concurrent`). */
	concurrent?: boolean;
}

type InProgressMessages = Record<string, InProgressMessage>;

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
		"toolExecutions",
		"stopped",
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

/** The text the model reads for a message: its context first, as on submit. */
const messageContent = (message: QueuedChatMessage): string =>
	message.contextPrefix
		? `${message.contextPrefix}\n\n---\n\n${message.text.trim()}`
		: message.text.trim();

const hasAttachments = (message: QueuedChatMessage): boolean =>
	message.images.length > 0 || message.documentRefs.length > 0;

const withoutKey = <T>(map: Record<string, T>, key: string) => {
	if (!(key in map)) return map;
	const { [key]: _removed, ...rest } = map;
	return rest;
};

/**
 * Hands a message to a run in progress. When the run cannot take it any more
 * it moves to the front of the chat's queue, to go out as the next message.
 */
const deliverMessage = async (
	conversationId: string,
	jobId: string,
	message: QueuedChatMessage,
) => {
	const accepted = await chatService.injectMessage(jobId, {
		id: message.id,
		content: messageContent(message),
	});
	if (accepted) return;
	const queue = useChatMessageQueueStore.getState();
	const returned = queue.removePending(conversationId, message.id);
	if (returned) queue.enqueue(conversationId, returned, "front");
};

export const useChat = (model: string, options: UseChatOptions = {}) => {
	const concurrentRef = useRef(options.concurrent ?? false);
	concurrentRef.current = options.concurrent ?? false;
	const [inputValue, setInputValue] = useState("");
	// By conversation: each chat's run has its own status and reply.
	const [statuses, setStatuses] = useState<Record<string, ChatStatus>>({});
	const {
		value: inProgressMessages,
		latestRef: inProgressMessagesRef,
		setCoalesced: setInProgressMessagesCoalesced,
		setImmediate: setInProgressMessagesImmediate,
	} = useFrameCoalescedState<InProgressMessages>({});

	// State selectors - only re-render when specific value changes
	const messages = useChatStore((state) => state.messages);
	const messageGroups = useChatStore((state) => state.messageGroups);
	const runs = useChatStore((state) => state.runs);
	const selectedTopic = useChatStore((state) => state.selectedTopic);
	const selectedAgentFlowId = useChatStore(
		(state) => state.selectedAgentFlowId,
	);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const queued = useChatMessageQueueStore((state) => state.queued);
	const paused = useChatMessageQueueStore((state) => state.paused);
	const availableAgents = useAgentConfigStore((state) => state.availableAgents);
	const agentNameOf = (agentFlowId: string | null | undefined) =>
		availableAgents.find((agent) => agent.id === agentFlowId)?.name;
	// Recorded on each message so a rendered block falls back to the agent's
	// theme rather than shadcn when the model omits the theme argument.
	const [openuiTheme, setOpenuiTheme] = useState<string | undefined>(undefined);
	useEffect(() => {
		let active = true;
		void getAgentOpenUITheme(selectedAgentFlowId ?? undefined).then((theme) => {
			if (active) setOpenuiTheme(theme);
		});
		return () => {
			active = false;
		};
	}, [selectedAgentFlowId]);

	// Action selectors - stable references, won't cause re-renders
	const setSelectedTopic = useChatStore((state) => state.setSelectedTopic);
	const setSelectedAgentFlowId = useChatStore(
		(state) => state.setSelectedAgentFlowId,
	);
	const addMessage = useChatStore((state) => state.addMessage);
	const updateMessage = useChatStore((state) => state.updateMessage);
	const ensureMainConversation = useChatStore(
		(state) => state.ensureMainConversation,
	);
	const loadMessageGroup = useChatStore((state) => state.loadMessageGroup);
	const deleteMessages = useChatStore((state) => state.deleteMessages);

	const isCustomMode =
		selectedAgentFlowId !== null && selectedAgentFlowId !== "chat";
	const currentConversationId = currentConversation?.id;
	// What this hook shows is the open chat's run; others go on unseen.
	const currentRun = currentConversationId
		? runs[currentConversationId]
		: undefined;
	const isLoading = currentRun !== undefined;
	const status: ChatStatus =
		(currentConversationId && statuses[currentConversationId]) || "ready";
	const inProgressMessage = currentConversationId
		? (inProgressMessages[currentConversationId] ?? null)
		: null;
	const abortController = currentRun?.controller ?? null;

	const setRunStatus = (conversationId: string, next: ChatStatus) =>
		setStatuses((previous) =>
			next === "ready"
				? withoutKey(previous, conversationId)
				: previous[conversationId] === next
					? previous
					: { ...previous, [conversationId]: next },
		);
	const updateInProgress = (
		conversationId: string,
		update: (message: InProgressMessage) => InProgressMessage,
	) =>
		setInProgressMessagesCoalesced((previous) => {
			const current = previous[conversationId];
			return current
				? { ...previous, [conversationId]: update(current) }
				: previous;
		});
	const setInProgress = (
		conversationId: string,
		message: InProgressMessage | null,
	) =>
		setInProgressMessagesImmediate((previous) =>
			message
				? { ...previous, [conversationId]: message }
				: withoutKey(previous, conversationId),
		);
	const latestToolExecutions = (conversationId: string) =>
		inProgressMessagesRef.current[conversationId]?.toolExecutions ?? [];

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
			.filter((msg) => !isNonModelMessageType(msg.type))
			.findLast((msg) => msg.role === "user" || msg.role === "assistant");

		if (lastMessage?.topicId) {
			setSelectedTopic(lastMessage.topicId);
		}
	}, [messages, isCustomMode]);

	// Stop the open chat's run
	const handleStop = () => {
		if (!currentConversationId) return;
		const run = useChatStore.getState().runs[currentConversationId];
		if (!run) return;
		// Stop ends the agent loop, not the turn: the run hands back what it got
		// done — text, steps, tool calls, tokens — and `submitMessage` saves it
		// the way it saves any finished message, then releases the composer.
		run.controller.abort();
		// A tool parked on a bot wall waits on a person, not on the stream, so
		// detaching the reader alone would leave it holding the run for minutes.
		void useWebChallengePromptStore.getState().cancelAll();
		// Same for a MemonOS Bot tool call parked on its agent's computer.
		void memonClient
			.request("control.cancelWaits", run.agentId ? { key: run.agentId } : {})
			.catch(() => undefined);
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
		conversationId: targetConversationId,
		agentFlowId: requestedAgentFlowId,
		topicId: requestedTopicId,
		concurrent = concurrentRef.current,
	}: {
		e?: React.FormEvent;
		inputText: string;
		attachedImages?: File[];
		attachedDocumentRefs?: AttachedDocumentRef[];
		contextPrefix?: string;
		clearComposer: boolean;
		/** The chat to send to; the open one by default. */
		conversationId?: string;
		/** The agent to send to; the composer's by default. */
		agentFlowId?: string | null;
		topicId?: string;
		concurrent?: boolean;
	}) => {
		e?.preventDefault();
		const store = useChatStore.getState();
		let runConversationId =
			targetConversationId ?? store.currentConversation?.id;
		if (
			!inputText.trim() ||
			!model ||
			findBlockingRun(store.runs, runConversationId, concurrent)
		) {
			return;
		}

		const agentFlowId =
			requestedAgentFlowId !== undefined
				? requestedAgentFlowId
				: store.selectedAgentFlowId;
		const customMode = agentFlowId !== null && agentFlowId !== "chat";
		const topic = requestedTopicId ?? store.selectedTopic;
		const agentFlowName = agentNameOf(agentFlowId);
		const token = Symbol("chat-run");
		const controller = new AbortController();
		const createRun = (conversationId: string): ChatRun => ({
			conversationId,
			agentId: customMode ? agentFlowId : null,
			startedAt: Date.now(),
			concurrent,
			token,
			controller,
		});
		// Claimed before anything is awaited, so nothing else starts in between.
		if (runConversationId) store.startRun(createRun(runConversationId));

		const rawInput = inputText.trim();
		const userMessageContent = rawInput;
		const effectiveUserMessageContent = contextPrefix
			? `${contextPrefix}\n\n---\n\n${rawInput}`
			: rawInput;
		if (clearComposer) {
			setInputValue("");
		}

		let assistantMessage: Message | null = null;
		let currentContent = "";
		let currentComplexContent: ComplexContent | null = null;
		let currentParts: MessageParts | null = null;
		let interrupted = false;

		try {
			if (!runConversationId) {
				runConversationId = (await ensureMainConversation()).id;
				useChatStore.getState().startRun(createRun(runConversationId));
			}
			// Every message of the run goes to the chat it started in, even after
			// the user switches to another.
			const conversationId = runConversationId;
			setRunStatus(conversationId, "submitted");
			// Writing again in a chat lets its queue go on.
			useChatMessageQueueStore.getState().setPaused(conversationId, false);

			// The open chat's messages are in the store; another's are read.
			const opened = useChatStore.getState();
			const history =
				opened.currentConversation?.id === conversationId
					? {
							messages: opened.messages,
							previousSeparator:
								opened.messageGroups.find((group) => group.isLatest)
									?.previousSeparator ?? null,
						}
					: await opened.fetchLatestMessages(conversationId);

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

			// The user may walk away from the page rather than pressing exit, so a
			// message typed here is what closes a session left open.
			if (shouldCloseCoAgentSession(history.messages)) {
				await addMessage({
					conversationId,
					role: "system",
					content: "",
					type: COAGENT_SESSION_END,
					createdAt: new Date(),
				});
			}

			// Add user message to store and database
			const userMessage = await addMessage({
				conversationId,
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
					customMode && topic && topic !== "default" && topic !== "__all__"
						? topic
						: undefined,
			});

			setRunStatus(conversationId, "streaming");

			// Find the latest separator index to only send messages after it
			const allMessages = [...history.messages, userMessage];
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
			const sendMessages: ChatMessage[] =
				await buildSendMessages(relevantMessages);

			// Create assistant message placeholder
			assistantMessage = await addMessage({
				conversationId,
				role: "assistant",
				content: "",
				// Use the same topicId as the user message for consistency
				topicId: userMessage.topicId,
			});

			// Set in-progress message for real-time updates
			setInProgress(conversationId, {
				id: assistantMessage.id,
				conversationId,
				content: "",
				complexContent: null,
				parts: null,
				actions: [],
			});

			// Execute chat via chat service
			const historySeparator = history.previousSeparator;
			const result = await chatService.chatStream(
				{
					messages: sendMessages,
					model: model,
					mode: customMode ? "custom" : "normal",
					topicId:
						customMode && topic && topic !== "__all__" ? topic : undefined,
					agentFlowId: agentFlowId ?? undefined,
					// Added to the chosen agent rather than replacing it, so turning
					// the co-agent on does not swap out the user's configuration.
					flowConfigPrefix: useCoAgentActivationStore.getState().isActive
						? createCoAgentFlowPrefixConfig()
						: undefined,
					conversation: {
						id: conversationId,
						inProgressMessage: { id: assistantMessage.id },
						agentFlowName: agentFlowName ?? undefined,
						...(historySeparator
							? {
									historyBoundary: {
										separatorId: historySeparator.id,
										createdAt: historySeparator.createdAt.toISOString(),
									},
								}
							: {}),
					},
					streamConfig: {
						minWordsToStream: 1,
						streamToolCallsImmediately: true,
					},
				},
				{
					onRunStarted: (jobId) => {
						useChatStore.getState().updateRun(conversationId, token, { jobId });
						// Sent before the run could take messages: hand them over now.
						for (const message of useChatMessageQueueStore.getState().pending[
							conversationId
						] ?? []) {
							void deliverMessage(conversationId, jobId, message);
						}
					},
					onInjectedMessageRead: ({ id }) => {
						useChatMessageQueueStore
							.getState()
							.removePending(conversationId, id);
					},
					onContent: (content) => {
						currentContent = content;
						// Only update in-progress message, not the store
						updateInProgress(conversationId, (prev) => ({ ...prev, content }));
					},
					onContentParts: (parts) => {
						currentComplexContent = cloneComplexContent(parts);
						updateInProgress(conversationId, (prev) => ({
							...prev,
							complexContent: currentComplexContent,
						}));
					},
					onParts: (parts) => {
						currentParts = cloneMessageParts(parts);
						updateInProgress(conversationId, (prev) => ({
							...prev,
							parts: currentParts,
						}));
					},
					onAction: (actions) => {
						// Only update in-progress message, not the store
						updateInProgress(conversationId, (prev) => ({
							...prev,
							actions: cloneActions(actions),
						}));
					},
					onExecuteStart: (event) => {
						updateInProgress(conversationId, (prev) => ({
							...prev,
							executeState: event,
							executions: addStreamingExecution(prev.executions, event),
						}));
					},
					onToolExecution: (execution) => {
						updateInProgress(conversationId, (prev) => ({
							...prev,
							toolExecutions: upsertToolExecution(
								prev.toolExecutions ?? [],
								execution,
							),
						}));
					},
					onCompaction: (compaction) => {
						updateInProgress(conversationId, (prev) => ({
							...prev,
							compactions: [...(prev.compactions ?? []), compaction],
						}));
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
				interrupted = true;
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
						toolExecutions: finishRunningToolExecutions(
							latestToolExecutions(conversationId),
							"failed",
						),
						error: result.errorMetadata ?? {
							message: errorMessage,
							rawMessage: result.error || errorMessage,
						},
						model,
						...(agentFlowName && { agentFlowName }),
						...(openuiTheme && { openuiTheme }),
					},
				});
				setInProgress(conversationId, null);
				setRunStatus(conversationId, "error");
				return;
			}

			interrupted = result.stopped === true;
			// A stopped run that never reported back: keep what was streamed.
			const detachedStop =
				result.stopped && !result.metadata
					? {
							stopped: true,
							toolExecutions: finishRunningToolExecutions(
								latestToolExecutions(conversationId),
								"cancelled",
							),
						}
					: {};
			updateMessage(assistantMessage.id, {
				content: finalContent,
				complexContent: finalComplexContent,
				parts: result.parts ?? null,
				metadata: {
					...pickResultMetadata(result.metadata),
					...detachedStop,
					...actionMetadata,
					model,
					...(agentFlowName && { agentFlowName }),
					...(openuiTheme && { openuiTheme }),
				},
			});

			// Clear in-progress message
			setInProgress(conversationId, null);
			setRunStatus(conversationId, "ready");
		} catch (error) {
			interrupted = true;
			const conversationId = runConversationId;
			// Check if error is due to user aborting the request
			if (isAbortError(error)) {
				logInfo("Chat request was stopped by user");
				if (conversationId) setRunStatus(conversationId, "ready");

				// Save any partial content that was streamed before abort
				const toolExecutions = conversationId
					? latestToolExecutions(conversationId)
					: [];
				if (assistantMessage && (currentContent || toolExecutions.length > 0)) {
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
							actions:
								(conversationId &&
									inProgressMessagesRef.current[conversationId]?.actions) ||
								[],
							toolExecutions: finishRunningToolExecutions(
								toolExecutions,
								"cancelled",
							),
							...(agentFlowName && { agentFlowName }),
							...(openuiTheme && { openuiTheme }),
						},
					});
					logInfo("Saved partial content from stopped generation");
				}

				// Clear in-progress message
				if (conversationId) setInProgress(conversationId, null);
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
						toolExecutions: finishRunningToolExecutions(
							conversationId ? latestToolExecutions(conversationId) : [],
							"failed",
						),
						model,
						...(agentFlowName && { agentFlowName }),
						...(openuiTheme && { openuiTheme }),
					},
				});
			} else {
				await addMessage({
					conversationId,
					role: "assistant",
					content: "Sorry, I encountered an error processing your message.",
					metadata: {
						error: errorMetadata,
						model,
						...(agentFlowName && { agentFlowName }),
						...(openuiTheme && { openuiTheme }),
					},
				});
			}

			// Clear in-progress message
			if (conversationId) {
				setInProgress(conversationId, null);
				setRunStatus(conversationId, "error");
			}
		} finally {
			if (runConversationId) {
				const queue = useChatMessageQueueStore.getState();
				// What the agent did not get to read goes out next, ahead of the
				// queue. After a stop or a failure the queue waits for the user.
				queue.enqueue(
					runConversationId,
					queue.takePending(runConversationId),
					"front",
				);
				if (interrupted) queue.setPaused(runConversationId, true);
				useChatStore.getState().finishRun(runConversationId, token);
				// The reply's usage is saved by now: the chat's cost moved.
				void useChatStore
					.getState()
					.refreshConversationCosts([runConversationId]);
			}
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

	/** A draft as it waits in a queue, with the agent it was written to. */
	const toQueuedMessage = (draft: ChatMessageDraft): QueuedChatMessage => {
		const store = useChatStore.getState();
		return {
			id: v4(),
			text: draft.text.trim(),
			images: draft.images ?? [],
			documentRefs: draft.documentRefs ?? [],
			contextPrefix: draft.contextPrefix,
			agentFlowId: store.selectedAgentFlowId,
			topicId: store.selectedTopic,
			concurrent: concurrentRef.current,
			createdAt: Date.now(),
		};
	};

	/** Sent once the chat's current run finishes. */
	const enqueueMessage = (conversationId: string, draft: ChatMessageDraft) => {
		if (!draft.text.trim()) return;
		useChatMessageQueueStore
			.getState()
			.enqueue(conversationId, toQueuedMessage(draft));
	};

	/**
	 * Sent into the chat's run: the agent reads it before its next request.
	 * Attachments need the full send, so a message with any goes next instead.
	 */
	const injectMessage = (
		conversationId: string,
		draft: ChatMessageDraft | QueuedChatMessage,
	) => {
		if (!draft.text.trim()) return;
		const message = "id" in draft ? draft : toQueuedMessage(draft);
		const queue = useChatMessageQueueStore.getState();
		const run = useChatStore.getState().runs[conversationId];
		if (!run || hasAttachments(message)) {
			queue.enqueue(conversationId, message, "front");
			queue.setPaused(conversationId, false);
			return;
		}
		queue.addPending(conversationId, message);
		// Before the job id is known the run takes it on start (`onRunStarted`).
		if (run.jobId) void deliverMessage(conversationId, run.jobId, message);
	};

	/** A queued message, now: into the run if one is going, otherwise next. */
	const sendQueuedMessage = (conversationId: string, id: string) => {
		const message = useChatMessageQueueStore
			.getState()
			.remove(conversationId, id);
		if (message) injectMessage(conversationId, message);
	};

	// Whenever a chat is free, its queue sends the next message — for every
	// chat, not only the open one.
	useEffect(() => {
		if (!model) return;
		for (const [conversationId, list] of Object.entries(queued)) {
			const next = list[0];
			if (!next || paused[conversationId]) continue;
			// Judged by the agent it was written to, not the one picked since.
			if (
				findBlockingRun(
					useChatStore.getState().runs,
					conversationId,
					next.concurrent,
				)
			) {
				continue;
			}
			const message = useChatMessageQueueStore
				.getState()
				.dequeue(conversationId);
			if (!message) continue;
			void submitMessage({
				inputText: message.text,
				attachedImages: message.images,
				attachedDocumentRefs: message.documentRefs,
				contextPrefix: message.contextPrefix,
				clearComposer: false,
				conversationId,
				agentFlowId: message.agentFlowId,
				topicId: message.topicId,
				concurrent: message.concurrent,
			});
		}
	}, [queued, paused, runs, model]);

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
		enqueueMessage,
		injectMessage,
		sendQueuedMessage,
	} as const;
};
