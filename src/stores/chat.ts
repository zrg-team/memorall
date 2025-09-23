import { create } from "zustand";
import {
	type Message,
	type Conversation,
	type NewConversation,
} from "@/services/database/db";
import { serviceManager } from "@/services";
import { eq, desc, asc } from "drizzle-orm";
import { logError } from "@/utils/logger";
import { v4 } from "@/utils/uuid";

interface ChatStore {
	// State
	messages: Message[];
	currentConversation: Conversation | null;
	isLoading: boolean;

	// Actions
	addMessage: (message: Partial<Message>) => Promise<Message>;
	updateMessage: (id: string, message: Partial<Message>) => void;
	finalizeMessage: (id: string, message: Partial<Message>) => Promise<void>;
	loadConversation: (id: string) => Promise<void>;
	createNewConversation: (title?: string) => Promise<Conversation>;
	ensureMainConversation: () => Promise<Conversation>;
	clearMessages: () => void;
	setLoading: (loading: boolean) => void;

	// Database sync
	syncWithDB: () => Promise<void>;
}

export const useChatStore = create<ChatStore>((set, get) => ({
	messages: [],
	currentConversation: null,
	isLoading: false,

	addMessage: async (messageData) => {
		let conversationId = messageData.conversationId;
		if (!conversationId && !get().currentConversation) {
			const conversation = await get().createNewConversation();
			conversationId = conversation.id;
		} else if (get().currentConversation) {
			conversationId = get().currentConversation!.id;
		}
		const message = {
			id: v4(),
			timestamp: new Date(),
			conversationId,
			...messageData,
		} as Message;
		if (!message.role || !message.conversationId) {
			throw new Error("Message must have a role and conversationId");
		}

		// Add to local state immediately
		set((state) => ({
			messages: [...state.messages, message],
		}));

		// Save to database
		try {
			await serviceManager.databaseService.use(({ db, schema }) =>
				db.insert(schema.messages).values(message),
			);
		} catch (error) {
			logError("Failed to save message to database:", error);
		}

		return message;
	},

	updateMessage: (id, message) => {
		set((state) => ({
			messages: state.messages.map((msg) =>
				msg.id === id ? { ...msg, ...message } : msg,
			),
		}));
	},

	finalizeMessage: async (id, inputMessage) => {
		const message = get().messages.find((msg) => msg.id === id);
		try {
			// Clean content to avoid UTF-8 issues
			const cleanContent = (
				inputMessage.content ||
				message?.content ||
				""
			).replace(
				/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
				"",
			);

			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.messages)
					.set({
						...message,
						...inputMessage,
						role: inputMessage.role || message?.role || "user",
						content: cleanContent,
						metadata: {
							...(message?.metadata || {}),
							...(inputMessage?.metadata || {}),
						},
					})
					.where(eq(schema.messages.id, id)),
			);
		} catch (error) {
			logError("Failed to finalize message in database:", error);
		}
	},

	createNewConversation: async (title?: string) => {
		try {
			const newConversation: NewConversation = {
				title: title || "Main Chat",
				metadata: {
					createdAt: new Date().toISOString(),
				},
			};

			// Get or create the conversation
			const conversation = await serviceManager.databaseService.use(
				async ({ db, schema }) => {
					const [created] = await db
						.insert(schema.conversations)
						.values(newConversation)
						.returning();
					return created;
				},
			);

			set({ currentConversation: conversation });
			return conversation;
		} catch (error) {
			logError("Failed to create conversation:", error);
			throw error;
		}
	},

	ensureMainConversation: async () => {
		try {
			// Pick the most recent conversation if exists; otherwise create one
			const existing = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.conversations)
						.orderBy(desc(schema.conversations.createdAt))
						.limit(1),
			);
			const messages = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.messages)
						.orderBy(asc(schema.messages.updatedAt)),
			);

			if (existing.length > 0) {
				set({ currentConversation: existing[0], messages });
				return existing[0];
			}

			return await get().createNewConversation("Main Chat");
		} catch (error) {
			logError("Failed to ensure main conversation:", error);
			throw error;
		}
	},

	loadConversation: async (id: string) => {
		try {
			// Load conversation
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

			// Load messages
			const messages = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, id))
						.orderBy(schema.messages.createdAt),
			);

			set({
				currentConversation: conversation,
				messages,
			});
		} catch (error) {
			logError("Failed to load conversation:", error);
			throw error;
		}
	},

	clearMessages: () => {
		set({
			messages: [],
			currentConversation: null,
		});
	},

	setLoading: (loading: boolean) => {
		set({ isLoading: loading });
	},

	syncWithDB: async () => {
		try {
			if (!get().currentConversation) return;

			const conversationId = get().currentConversation!.id;

			// Load latest messages from DB
			const messages = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.messages)
						.where(eq(schema.messages.conversationId, conversationId))
						.orderBy(schema.messages.createdAt),
			);

			set({ messages });
		} catch (error) {
			logError("Failed to sync with database:", error);
		}
	},
}));
