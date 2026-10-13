import { create } from "zustand";
import { and, asc, desc, eq, gt, lt, ne } from "drizzle-orm";
import {
	type Message,
	type Conversation,
	type NewConversation,
} from "@/services/database/types";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";
import { replaceEqualDeep } from "@/utils/replace-equal-deep";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { v4 } from "@/utils/uuid";
import type { ChatMode } from "@/main/modules/chat/services/chat-service";
import {
	type ConversationCost,
	loadConversationCosts,
} from "@/main/modules/chat/utils/conversation-costs";
import {
	type RunUsage,
	withRunUsage,
} from "@/main/modules/chat/utils/conversation-cost-format";
import { platform } from "@/platform/current";

/** The agent picked last in the composer ("chat" for none), kept across reloads. */
export const SELECTED_AGENT_STORAGE_KEY = "memorall.chat.selectedAgent";

const readRememberedAgentFlowId = async (): Promise<string | null> => {
	try {
		const stored = await platform.persistentStore.get<string>(
			SELECTED_AGENT_STORAGE_KEY,
		);
		return typeof stored === "string" && stored ? stored : null;
	} catch {
		return null;
	}
};

export interface ChatMessageGroup {
	id: string;
	previousSeparator: Message | null;
	separator: Message | null;
	messages: Message[];
	isLatest: boolean;
	isLoaded: boolean;
	isLoading: boolean;
}

/** A chat run in progress; at most one per chat. */
export interface ChatRun {
	conversationId: string;
	agentId: string | null;
	startedAt: number;
	/**
	 * Whether it may share the time with runs in other chats. Only runs on a
	 * remote model without an agent computer can: a local model serves one
	 * request at a time, and an agent's computer is one screen.
	 */
	concurrent: boolean;
	/** Tells this run apart from a later one in the same chat. */
	token: symbol;
	/** Stops the run. */
	controller: AbortController;
	/** The background job, once started: what injected messages address. */
	jobId?: string;
	/** What the reply has used so far; the chat's cost shows it on top. */
	usage?: RunUsage;
}

/**
 * The run that keeps a new one in `conversationId` from starting, if any:
 * its own chat's run, or a run elsewhere when either of the two cannot run
 * concurrently.
 */
export const findBlockingRun = (
	runs: Record<string, ChatRun>,
	conversationId: string | undefined,
	concurrent: boolean,
): ChatRun | undefined => {
	if (conversationId && runs[conversationId]) return runs[conversationId];
	return Object.values(runs).find(
		(run) =>
			run.conversationId !== conversationId && !(concurrent && run.concurrent),
	);
};

interface ChatStore {
	// State
	messages: Message[];
	messageGroups: ChatMessageGroup[];
	conversations: Conversation[];
	/** What each listed chat has cost so far, by conversation id. */
	conversationCosts: Record<string, ConversationCost>;
	currentConversation: Conversation | null;
	/** Whether any chat has a run in progress. */
	isLoading: boolean;
	/** The runs in progress, by conversation id. */
	runs: Record<string, ChatRun>;
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
	/** Adds up these chats' costs again (default: the listed ones). */
	refreshConversationCosts: (conversationIds?: string[]) => Promise<void>;
	loadMessageGroup: (groupId: string) => Promise<void>;
	/**
	 * A chat's latest messages (after its last split) and that split, read
	 * from the database: for sending to a chat that is not the open one.
	 */
	fetchLatestMessages: (conversationId: string) => Promise<{
		messages: Message[];
		previousSeparator: Message | null;
	}>;
	createNewConversation: (title?: string) => Promise<Conversation>;
	renameConversation: (id: string, title: string) => Promise<void>;
	toggleConversationPinned: (id: string) => Promise<void>;
	ensureMainConversation: () => Promise<Conversation>;
	deleteConversation: (id: string) => Promise<void>;
	clearMessages: () => void;
	deleteMessages: () => void;
	startRun: (run: ChatRun) => void;
	updateRun: (
		conversationId: string,
		token: symbol,
		patch: Partial<Pick<ChatRun, "jobId" | "usage">>,
	) => void;
	/** Ends the run, unless a newer one has taken the chat since. */
	finishRun: (conversationId: string, token: symbol) => void;
	setChatMode: (mode: ChatMode) => void;
	setSelectedTopic: (topicId: string) => void;
	setSelectedAgentFlowId: (flowId: string | null) => void;
	/**
	 * With no agent selected yet: the one picked last time if it is still
	 * available, otherwise the first that is.
	 */
	restoreSelectedAgentFlowId: (availableIds: string[]) => Promise<void>;

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

/**
 * The groups with one message changed. Only the group holding it is a new
 * object: rebuilding every group re-rendered every group on screen each time a
 * reply was saved.
 */
const replaceMessageInGroups = (
	groups: ChatMessageGroup[],
	messageId: string,
	message: Partial<Message>,
) => {
	const groupIndex = groups.findIndex((group) =>
		group.messages.some((current) => current.id === messageId),
	);
	if (groupIndex === -1) return groups;
	return groups.map((group, index) =>
		index === groupIndex
			? {
					...group,
					messages: group.messages.map((current) =>
						current.id === messageId ? { ...current, ...message } : current,
					),
				}
			: group,
	);
};

/** `next`, or `previous` when the two are equal, reading dates by their time. */
const reuseEqualValue = (previous: unknown, next: unknown): unknown =>
	previous instanceof Date && next instanceof Date
		? previous.getTime() === next.getTime()
			? previous
			: next
		: replaceEqualDeep(previous, next);

/**
 * A row read again from the database, as the object already held for it when
 * nothing in it changed (and with its unchanged fields kept when something
 * did). The database hands back new objects on every read, and each of them
 * renders its message again.
 */
const reuseEqualRow = <T extends object>(
	previous: T | null | undefined,
	next: T,
): T => {
	if (!previous) return next;
	const keys = Object.keys(next) as Array<keyof T>;
	let equal = keys.length === Object.keys(previous).length;
	const merged = {} as T;
	for (const key of keys) {
		const kept = reuseEqualValue(previous[key], next[key]) as T[keyof T];
		if (kept !== previous[key] || !(key in previous)) equal = false;
		merged[key] = kept;
	}
	return equal ? previous : merged;
};

const reuseEqualRows = <T extends { id: string }>(
	previous: T[],
	next: T[],
): T[] => {
	const heldById = new Map(previous.map((row) => [row.id, row]));
	const rows = next.map((row) => reuseEqualRow(heldById.get(row.id), row));
	return rows.length === previous.length &&
		rows.every((row, index) => row === previous[index])
		? previous
		: rows;
};

const GROUP_FIELDS = [
	"id",
	"previousSeparator",
	"separator",
	"messages",
	"isLatest",
	"isLoaded",
	"isLoading",
] as const satisfies ReadonlyArray<keyof ChatMessageGroup>;

/**
 * A chat's groups read again, keeping what is on screen: a group the user has
 * opened keeps its messages (a group is only read when opened, and re-reading
 * the chat used to fold every one of them up again), and a group in which
 * nothing changed stays the same object.
 */
const reuseGroups = (
	previous: ChatMessageGroup[],
	next: ChatMessageGroup[],
): ChatMessageGroup[] => {
	const heldById = new Map(previous.map((group) => [group.id, group]));
	const groups = next.map((group) => {
		const held = heldById.get(group.id);
		if (!held) return group;
		const candidate: ChatMessageGroup = {
			...group,
			previousSeparator:
				group.previousSeparator &&
				reuseEqualRow(held.previousSeparator, group.previousSeparator),
			separator:
				group.separator && reuseEqualRow(held.separator, group.separator),
			...(group.isLatest
				? { messages: reuseEqualRows(held.messages, group.messages) }
				: {
						messages: held.messages,
						isLoaded: held.isLoaded,
						isLoading: held.isLoading,
					}),
		};
		return GROUP_FIELDS.every((field) => candidate[field] === held[field])
			? held
			: candidate;
	});
	return groups.length === previous.length &&
		groups.every((group, index) => group === previous[index])
		? previous
		: groups;
};

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
		const readGroups = createGroupsFromSeparators(separators, latestMessages);
		const state = get();
		if (state.currentConversation?.id !== conversation.id) {
			const latestGroup = getLatestGroup(readGroups) ?? createLatestGroup(null);
			set({
				currentConversation: conversation,
				messageGroups: readGroups,
				messages: latestGroup.messages,
			});
			return conversation;
		}

		// The chat on screen read again (the page coming back into focus does
		// this): only what changed is new, and when nothing did, nothing is set.
		const currentConversation = reuseEqualRow(
			state.currentConversation,
			conversation,
		);
		const messageGroups = reuseGroups(state.messageGroups, readGroups);
		const latestGroup =
			getLatestGroup(messageGroups) ?? createLatestGroup(null);
		const messages = reuseEqualRows(state.messages, latestGroup.messages);
		if (
			currentConversation !== state.currentConversation ||
			messageGroups !== state.messageGroups ||
			messages !== state.messages
		) {
			set({ currentConversation, messageGroups, messages });
		}

		return currentConversation;
	};

	return {
		messages: [],
		messageGroups: [createLatestGroup(null)],
		currentConversation: null,
		conversations: [],
		conversationCosts: {},
		isLoading: false,
		runs: {},
		chatMode: "custom",
		selectedTopic: "default",
		selectedAgentFlowId: null,

		addMessage: async (messageData) => {
			// A run passes its own chat, so a message written after the user
			// switched chats still lands where the run started.
			let conversationId = messageData.conversationId;
			if (!conversationId) {
				conversationId =
					get().currentConversation?.id ??
					(await get().createNewConversation()).id;
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
				// Another chat is on screen: the message is only stored.
				if (state.currentConversation?.id !== message.conversationId) {
					return {};
				}
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
				// A reply's usage is in: the chat's cost moved.
				const conversationId =
					updatedMessage.conversationId ?? get().currentConversation?.id;
				if (updatedMessage.role === "assistant" && conversationId) {
					void get().refreshConversationCosts([conversationId]);
				}
			} catch (error) {
				logError("Failed to finalize message in database:", error);
			}
		},

		refreshConversationCosts: async (conversationIds) => {
			const ids =
				conversationIds ?? get().conversations.map((entry) => entry.id);
			if (!ids.length) return;
			try {
				const costs = await loadConversationCosts(ids);
				set((state) => {
					const next = { ...state.conversationCosts };
					for (const id of ids) {
						if (costs[id]) next[id] = costs[id];
						else delete next[id];
					}
					return { conversationCosts: next };
				});
			} catch (error) {
				logError("Failed to add up the chats' costs:", error);
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
							// Media studios keep their own history.
							.where(eq(schema.conversations.mode, "chat"))
							.orderBy(
								desc(schema.conversations.updatedAt),
								desc(schema.conversations.createdAt),
							)
							.limit(50),
				);

				set({ conversations });
				void get().refreshConversationCosts(
					conversations.map((entry) => entry.id),
				);
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
							.where(eq(schema.conversations.mode, "chat"))
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
						.where(eq(schema.conversations.mode, "chat"))
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

		fetchLatestMessages: async (conversationId) => {
			const separators = await queryConversationSeparators(conversationId);
			const previousSeparator = separators.at(-1) ?? null;
			const messages = await queryConversationMessages(
				conversationId,
				previousSeparator,
				null,
			);
			return { messages, previousSeparator };
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

		startRun: (run) => {
			set((state) => ({
				runs: { ...state.runs, [run.conversationId]: run },
				isLoading: true,
			}));
		},

		updateRun: (conversationId, token, patch) => {
			set((state) => {
				const run = state.runs[conversationId];
				if (!run || run.token !== token) return {};
				return {
					runs: { ...state.runs, [conversationId]: { ...run, ...patch } },
				};
			});
		},

		finishRun: (conversationId, token) => {
			set((state) => {
				const finished = state.runs[conversationId];
				if (finished?.token !== token) return {};
				const { [conversationId]: _finished, ...runs } = state.runs;
				// Kept in the total until the saved one is read back, so the cost
				// does not drop to what it was before the reply in between.
				const cost = withRunUsage(
					state.conversationCosts[conversationId],
					finished.usage,
				);
				return {
					runs,
					isLoading: Object.keys(runs).length > 0,
					...(cost && finished.usage
						? {
								conversationCosts: {
									...state.conversationCosts,
									[conversationId]: cost,
								},
							}
						: {}),
				};
			});
		},

		setChatMode: (mode: ChatMode) => {
			set({ chatMode: mode });
		},

		setSelectedTopic: (topicId: string) => {
			set({ selectedTopic: topicId });
		},

		setSelectedAgentFlowId: (flowId: string | null) => {
			set({ selectedAgentFlowId: flowId });
			if (flowId) {
				void platform.persistentStore
					.set(SELECTED_AGENT_STORAGE_KEY, flowId)
					.catch(() => undefined);
			}
		},

		restoreSelectedAgentFlowId: async (availableIds) => {
			if (get().selectedAgentFlowId) return;
			const remembered = await readRememberedAgentFlowId();
			// Picked by the user while the stored choice was being read.
			if (get().selectedAgentFlowId) return;
			const next =
				remembered &&
				(remembered === "chat" || availableIds.includes(remembered))
					? remembered
					: availableIds[0];
			if (next) set({ selectedAgentFlowId: next });
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
