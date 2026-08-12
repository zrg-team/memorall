import { create } from "zustand";
import { and, asc, desc, eq, gt, lt, ne } from "drizzle-orm";
import {
	type Message,
	type Conversation,
	type NewConversation,
} from "@/services/database/types";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { v4 } from "@/utils/uuid";
import type { ChatMode } from "@/main/modules/chat/services/chat-service";

export interface ChatMessageGroup {
	id: string;
	previousSeparator: Message | null;
	separator: Message | null;
	messages: Message[];
	isLatest: boolean;
	isLoaded: boolean;
	isLoading: boolean;
}

interface ChatStore {
	// State
	messages: Message[];
	messageGroups: ChatMessageGroup[];
	conversations: Conversation[];
	currentConversation: Conversation | null;
	isLoading: boolean;
	chatMode: ChatMode;
	selectedTopic: string;
	selectedAgentFlowId: string | null;

	// Actions
	addMessage: (message: Partial<Message>) => Promise<Message>;
	updateMessage: (id: string, message: Partial<Message>) => void;
	persistMessageContent: (id: string, content: string) => Promise<void>;
	finalizeMessage: (id: string, message: Partial<Message>) => Promise<void>;
	loadConversation: (id: string) => Promise<void>;
	loadConversations: () => Promise<void>;
	loadMessageGroup: (groupId: string) => Promise<void>;
	createNewConversation: (title?: string) => Promise<Conversation>;
	renameConversation: (id: string, title: string) => Promise<void>;
	toggleConversationPinned: (id: string) => Promise<void>;
	ensureMainConversation: () => Promise<Conversation>;
	deleteConversation: (id: string) => Promise<void>;
	clearMessages: () => void;
	deleteMessages: () => void;
	setLoading: (loading: boolean) => void;
	setChatMode: (mode: ChatMode) => void;
	setSelectedTopic: (topicId: string) => void;
	setSelectedAgentFlowId: (flowId: string | null) => void;

	// Database sync
	syncWithDB: () => Promise<void>;
}

type ConversationMetadata = Record<string, unknown>;

const getConversationMetadata = (
	conversation: Conversation,
): ConversationMetadata =>
	conversation.metadata && typeof conversation.metadata === "object"
		? (conversation.metadata as ConversationMetadata)
		: {};

const normalizeMessageSummary = (content: string): string =>
	content
		.replace(/<context>[\s\S]*?<\/context>/gi, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/[`*_#[\]()>-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const truncateSummary = (value: string, maxLength: number): string =>
	value.length > maxLength
		? `${value.slice(0, maxLength - 1).trimEnd()}…`
		: value;

const getAutomaticConversationTitle = (content: string): string =>
	truncateSummary(normalizeMessageSummary(content), 58) || "New chat";

const isPlaceholderConversationTitle = (title?: string | null): boolean =>
	!title?.trim() ||
	["main chat", "new chat", "untitled chat"].includes(
		title.trim().toLowerCase(),
	);

const buildLatestGroupId = (previousSeparator: Message | null) =>
	`group:latest:${previousSeparator?.id ?? "root"}`;

const buildCompletedGroupId = (separator: Message) => `group:${separator.id}`;

const createLatestGroup = (
	previousSeparator: Message | null,
	messages: Message[] = [],
): ChatMessageGroup => ({
	id: buildLatestGroupId(previousSeparator),
	previousSeparator,
	separator: null,
	messages,
	isLatest: true,
	isLoaded: true,
	isLoading: false,
});

const createGroupsFromSeparators = (
	separators: Message[],
	latestMessages: Message[],
): ChatMessageGroup[] => {
	let previousSeparator: Message | null = null;
	const groups = separators.map((separator): ChatMessageGroup => {
		const group = {
			id: buildCompletedGroupId(separator),
			previousSeparator,
			separator,
			messages: [],
			isLatest: false,
			isLoaded: false,
			isLoading: false,
		};
		previousSeparator = separator;
		return group;
	});
	groups.push(createLatestGroup(previousSeparator, latestMessages));
	return groups;
};

const getLatestGroup = (
	groups: ChatMessageGroup[],
): ChatMessageGroup | undefined => groups.find((group) => group.isLatest);

const replaceGroup = (
	groups: ChatMessageGroup[],
	groupId: string,
	updater: (group: ChatMessageGroup) => ChatMessageGroup,
) => groups.map((group) => (group.id === groupId ? updater(group) : group));

const replaceMessageInGroups = (
	groups: ChatMessageGroup[],
	messageId: string,
	message: Partial<Message>,
) =>
	groups.map((group) => ({
		...group,
		messages: group.messages.map((current) =>
			current.id === messageId ? { ...current, ...message } : current,
		),
	}));

export const useChatStore = create<ChatStore>((set, get) => {
	const groupLoads = new Map<string, Promise<void>>();
	let hydrationVersion = 0;

	const queryConversationMessages = async (
		conversationId: string,
		previousSeparator?: Message | null,
		separator?: Message | null,
	) =>
		serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.messages)
				.where(
					and(
						eq(schema.messages.conversationId, conversationId),
						ne(schema.messages.type, "separator"),
						...(previousSeparator
							? [gt(schema.messages.createdAt, previousSeparator.createdAt)]
							: []),
						...(separator
							? [lt(schema.messages.createdAt, separator.createdAt)]
							: []),
					),
				)
				.orderBy(asc(schema.messages.createdAt)),
		);

	const queryConversationSeparators = async (conversationId: string) =>
		serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.messages)
				.where(
					and(
						eq(schema.messages.conversationId, conversationId),
						eq(schema.messages.type, "separator"),
					),
				)
				.orderBy(asc(schema.messages.createdAt)),
		);

	const hydrateConversation = async (conversation: Conversation) => {
		const version = ++hydrationVersion;
		const separators = await queryConversationSeparators(conversation.id);
		const latestMessages = await queryConversationMessages(
			conversation.id,
			separators.at(-1) ?? null,
			null,
		);
		if (version !== hydrationVersion) return conversation;
		const messageGroups = createGroupsFromSeparators(
			separators,
			latestMessages,
		);
		const latestGroup =
			getLatestGroup(messageGroups) ?? createLatestGroup(null);

		set({
			currentConversation: conversation,
			messageGroups,
			messages: latestGroup.messages,
		});

		return conversation;
	};

	return {
		messages: [],
		messageGroups: [createLatestGroup(null)],
		currentConversation: null,
		conversations: [],
		isLoading: false,
		chatMode: "custom",
		selectedTopic: "default",
		selectedAgentFlowId: null,

		addMessage: async (messageData) => {
			let conversationId = messageData.conversationId;
			if (!conversationId && !get().currentConversation) {
				const conversation = await get().createNewConversation();
				conversationId = conversation.id;
			} else if (get().currentConversation) {
				conversationId = get().currentConversation!.id;
			}

			const messageId = messageData.id || v4();
			const now = messageData.createdAt ?? new Date();

			const message = {
				...messageData,
				id: messageId,
				conversationId,
				type: messageData.type ?? "text",
				createdAt: now,
				updatedAt: messageData.updatedAt ?? now,
			} as Message;

			if (!message.role || !message.conversationId) {
				throw new Error("Message must have a role and conversationId");
			}

			set((state) => {
				const existingLatestGroup =
					getLatestGroup(state.messageGroups) ?? createLatestGroup(null);

				if (message.type === "separator") {
					const groupsWithoutLatest = state.messageGroups.filter(
						(group) => !group.isLatest,
					);
					const completedGroup: ChatMessageGroup = {
						...existingLatestGroup,
						id: buildCompletedGroupId(message),
						separator: message,
						isLatest: false,
					};
					const nextLatestGroup = createLatestGroup(message);

					return {
						messages: [],
						messageGroups: [
							...groupsWithoutLatest,
							completedGroup,
							nextLatestGroup,
						],
					};
				}

				const nextLatestGroup: ChatMessageGroup = {
					...existingLatestGroup,
					messages: [...existingLatestGroup.messages, message],
				};
				const nextGroups =
					state.messageGroups.length === 0
						? [nextLatestGroup]
						: replaceGroup(
								state.messageGroups,
								existingLatestGroup.id,
								() => nextLatestGroup,
							);

				return {
					messages: [...state.messages, message],
					messageGroups: nextGroups,
				};
			});

			try {
				await serviceManager.databaseService.use(({ db, schema }) =>
					db.insert(schema.messages).values(message).onConflictDoNothing(),
				);
			} catch (error) {
				logError("Failed to save message to database:", error);
			}

			const summary = normalizeMessageSummary(message.content ?? "");
			const currentConversation = get().currentConversation;
			if (
				message.type !== "separator" &&
				summary &&
				currentConversation?.id === message.conversationId
			) {
				const shouldCreateTitle =
					message.role === "user" &&
					isPlaceholderConversationTitle(currentConversation.title);
				const updatedAt = new Date();
				const conversationUpdate = {
					...(shouldCreateTitle
						? { title: getAutomaticConversationTitle(summary) }
						: {}),
					metadata: {
						...getConversationMetadata(currentConversation),
						lastMessagePreview: truncateSummary(summary, 96),
						lastMessageRole: message.role,
					},
					updatedAt,
				};

				try {
					await serviceManager.databaseService.use(({ db, schema }) =>
						db
							.update(schema.conversations)
							.set(conversationUpdate)
							.where(eq(schema.conversations.id, currentConversation.id)),
					);

					set((state) => {
						const updatedConversation = {
							...currentConversation,
							...conversationUpdate,
						};
						return {
							currentConversation: updatedConversation,
							conversations: state.conversations.map((conversation) =>
								conversation.id === currentConversation.id
									? updatedConversation
									: conversation,
							),
						};
					});
				} catch (error) {
					logError("Failed to update conversation summary:", error);
				}
			}

			return message;
		},

		updateMessage: (id, message) => {
			set((state) => ({
				messages: state.messages.map((msg) =>
					msg.id === id ? { ...msg, ...message } : msg,
				),
				messageGroups: replaceMessageInGroups(state.messageGroups, id, message),
			}));
		},

		persistMessageContent: async (id, content) => {
			const updatedAt = new Date();

			try {
				await serviceManager.databaseService.use(({ db, schema }) =>
					db
						.update(schema.messages)
						.set({ content, updatedAt })
						.where(eq(schema.messages.id, id)),
				);

				set((state) => ({
					messages: state.messages.map((msg) =>
						msg.id === id ? { ...msg, content, updatedAt } : msg,
					),
					messageGroups: replaceMessageInGroups(state.messageGroups, id, {
						content,
						updatedAt,
					}),
				}));
			} catch (error) {
				logError("Failed to persist message content:", error);
				throw error;
			}
		},

		finalizeMessage: async (id, inputMessage) => {
			const message = get().messages.find((msg) => msg.id === id);
			try {
				const cleanContent = (
					inputMessage.content ||
					message?.content ||
					""
				).replace(
					/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
					"",
				);

				const mergedMetadata = sanitizeForJson({
					...(message?.metadata || {}),
					...(inputMessage?.metadata || {}),
				}) as Record<string, unknown>;

				const updatedMessage = {
					...message,
					...inputMessage,
					role: inputMessage.role || message?.role || "user",
					content: cleanContent,
					metadata: mergedMetadata,
				};

				await serviceManager.databaseService.use(({ db, schema }) =>
					db
						.update(schema.messages)
						.set(updatedMessage)
						.where(eq(schema.messages.id, id)),
				);

				set((state) => ({
					messages: state.messages.map((msg) =>
						msg.id === id ? { ...msg, ...updatedMessage } : msg,
					),
					messageGroups: replaceMessageInGroups(
						state.messageGroups,
						id,
						updatedMessage,
					),
				}));
			} catch (error) {
				logError("Failed to finalize message in database:", error);
			}
		},

		createNewConversation: async (title?: string) => {
			try {
				const newConversation: NewConversation = {
					title: title || "New chat",
					metadata: {
						createdAt: new Date().toISOString(),
					},
				};

				const conversation = await serviceManager.databaseService.use(
					async ({ db, schema }) => {
						const [created] = await db
							.insert(schema.conversations)
							.values(newConversation)
							.returning();
						return created;
					},
				);

				set({
					currentConversation: conversation,
					conversations: [
						conversation,
						...get().conversations.filter(
							(item) => item.id !== conversation.id,
						),
					],
					messageGroups: [createLatestGroup(null)],
					messages: [],
				});
				return conversation;
			} catch (error) {
				logError("Failed to create conversation:", error);
				throw error;
			}
		},

		renameConversation: async (id, title) => {
			const normalizedTitle = title.trim();
			if (!normalizedTitle) return;
			const updatedAt = new Date();

			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.conversations)
					.set({ title: normalizedTitle, updatedAt })
					.where(eq(schema.conversations.id, id)),
			);

			set((state) => ({
				currentConversation:
					state.currentConversation?.id === id
						? {
								...state.currentConversation,
								title: normalizedTitle,
								updatedAt,
							}
						: state.currentConversation,
				conversations: state.conversations.map((conversation) =>
					conversation.id === id
						? { ...conversation, title: normalizedTitle, updatedAt }
						: conversation,
				),
			}));
		},

		toggleConversationPinned: async (id) => {
			const conversation = get().conversations.find((item) => item.id === id);
			if (!conversation) return;
			const metadata = getConversationMetadata(conversation);
			const nextMetadata = { ...metadata, pinned: metadata.pinned !== true };

			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.conversations)
					.set({ metadata: nextMetadata })
					.where(eq(schema.conversations.id, id)),
			);

			set((state) => ({
				currentConversation:
					state.currentConversation?.id === id
						? { ...state.currentConversation, metadata: nextMetadata }
						: state.currentConversation,
				conversations: state.conversations.map((item) =>
					item.id === id ? { ...item, metadata: nextMetadata } : item,
				),
			}));
		},

		loadConversations: async () => {
			try {
				const conversations = await serviceManager.databaseService.use(
					({ db, schema }) =>
						db
							.select()
							.from(schema.conversations)
							.orderBy(
								desc(schema.conversations.updatedAt),
								desc(schema.conversations.createdAt),
							)
							.limit(50),
				);

				set({ conversations });
			} catch (error) {
				logError("Failed to load conversations:", error);
			}
		},

		ensureMainConversation: async () => {
			try {
				const existing = await serviceManager.databaseService.use(
					({ db, schema }) =>
						db
							.select()
							.from(schema.conversations)
							.orderBy(desc(schema.conversations.createdAt))
							.limit(1),
				);

				if (existing.length > 0) {
					return await hydrateConversation(existing[0]);
				}

				return await get().createNewConversation("New chat");
			} catch (error) {
				logError("Failed to ensure main conversation:", error);
				throw error;
			}
		},

		loadConversation: async (id: string) => {
			try {
				const conversation = await serviceManager.databaseService.use(
					async ({ db, schema }) => {
						const [conv] = await db
							.select()
							.from(schema.conversations)
							.where(eq(schema.conversations.id, id));
						return conv;
					},
				);

				if (!conversation) {
					throw new Error("Conversation not found");
				}

				await hydrateConversation(conversation);
			} catch (error) {
				logError("Failed to load conversation:", error);
				throw error;
			}
		},

		deleteConversation: async (id: string) => {
			try {
				let nextConversation: Conversation | undefined;

				await serviceManager.databaseService.use(async ({ db, schema }) => {
					await db
						.delete(schema.messages)
						.where(eq(schema.messages.conversationId, id));
					await db
						.delete(schema.conversations)
						.where(eq(schema.conversations.id, id));

					const [next] = await db
						.select()
						.from(schema.conversations)
						.orderBy(
							desc(schema.conversations.updatedAt),
							desc(schema.conversations.createdAt),
						)
						.limit(1);
					nextConversation = next;
				});

				set((state) => ({
					conversations: state.conversations.filter(
						(conversation) => conversation.id !== id,
					),
				}));

				if (get().currentConversation?.id === id) {
					if (nextConversation) {
						await hydrateConversation(nextConversation);
					} else {
						set({
							currentConversation: null,
							messages: [],
							messageGroups: [createLatestGroup(null)],
						});
					}
				}

				await get().loadConversations();
			} catch (error) {
				logError("Failed to delete conversation:", error);
				throw error;
			}
		},

		loadMessageGroup: async (groupId) => {
			const conversation = get().currentConversation;
			const group = get().messageGroups.find((item) => item.id === groupId);
			if (!conversation || !group || group.isLatest || group.isLoaded) return;

			const loadKey = `${conversation.id}:${groupId}`;
			const existing = groupLoads.get(loadKey);
			if (existing) return existing;

			const load = (async () => {
				set((state) => ({
					messageGroups: replaceGroup(state.messageGroups, groupId, (item) => ({
						...item,
						isLoading: true,
					})),
				}));

				try {
					const loadedMessages = await queryConversationMessages(
						conversation.id,
						group.previousSeparator,
						group.separator,
					);
					if (get().currentConversation?.id !== conversation.id) return;
					set((state) => ({
						messageGroups: replaceGroup(
							state.messageGroups,
							groupId,
							(item) => ({
								...item,
								messages: loadedMessages,
								isLoaded: true,
								isLoading: false,
							}),
						),
					}));
				} catch (error) {
					if (get().currentConversation?.id === conversation.id) {
						set((state) => ({
							messageGroups: replaceGroup(
								state.messageGroups,
								groupId,
								(item) => ({ ...item, isLoading: false }),
							),
						}));
					}
					logError("Failed to load message group:", error);
					throw error;
				} finally {
					groupLoads.delete(loadKey);
				}
			})();
			groupLoads.set(loadKey, load);
			return load;
		},

		clearMessages: () => {
			hydrationVersion += 1;
			set({
				messages: [],
				messageGroups: [createLatestGroup(null)],
				currentConversation: null,
			});
		},

		deleteMessages: async () => {
			const currentConversation = get().currentConversation;
			if (!currentConversation) return;

			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.delete(schema.messages)
					.where(eq(schema.messages.conversationId, currentConversation.id)),
			);
			set({
				messages: [],
				messageGroups: [createLatestGroup(null)],
				currentConversation,
			});
		},

		setLoading: (loading: boolean) => {
			set({ isLoading: loading });
		},

		setChatMode: (mode: ChatMode) => {
			set({ chatMode: mode });
		},

		setSelectedTopic: (topicId: string) => {
			set({ selectedTopic: topicId });
		},

		setSelectedAgentFlowId: (flowId: string | null) => {
			set({ selectedAgentFlowId: flowId });
		},

		syncWithDB: async () => {
			try {
				if (!get().currentConversation) return;
				await get().loadConversation(get().currentConversation!.id);
			} catch (error) {
				logError("Failed to sync with database:", error);
			}
		},
	};
});
