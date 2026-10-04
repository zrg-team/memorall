import { create } from "zustand";
import type { AttachedDocumentRef } from "@/types/chat";

/** A message written while its chat was busy. */
export interface QueuedChatMessage {
	id: string;
	text: string;
	images: File[];
	documentRefs: AttachedDocumentRef[];
	contextPrefix?: string;
	/** The agent and memory chosen when it was written. */
	agentFlowId: string | null;
	topicId?: string;
	/** Whether its run may share the time with other chats' (`ChatRun.concurrent`). */
	concurrent: boolean;
	createdAt: number;
}

type ByConversation<T> = Record<string, T>;

interface ChatMessageQueueStore {
	/** Sent once the chat's run finishes, oldest first. */
	queued: ByConversation<QueuedChatMessage[]>;
	/** Injected into the chat's run, not read by the agent yet. */
	pending: ByConversation<QueuedChatMessage[]>;
	/** Chats whose queue waits for the user: their run was stopped or failed. */
	paused: ByConversation<boolean>;

	enqueue: (
		conversationId: string,
		messages: QueuedChatMessage | QueuedChatMessage[],
		position?: "back" | "front",
	) => void;
	/** Takes the oldest queued message. */
	dequeue: (conversationId: string) => QueuedChatMessage | undefined;
	/** Takes one queued message out, wherever it is. */
	remove: (conversationId: string, id: string) => QueuedChatMessage | undefined;
	addPending: (conversationId: string, message: QueuedChatMessage) => void;
	removePending: (
		conversationId: string,
		id: string,
	) => QueuedChatMessage | undefined;
	/** Takes every pending message. */
	takePending: (conversationId: string) => QueuedChatMessage[];
	setPaused: (conversationId: string, paused: boolean) => void;
}

const withList = <T>(
	map: ByConversation<T[]>,
	conversationId: string,
	list: T[],
): ByConversation<T[]> => {
	if (list.length > 0) return { ...map, [conversationId]: list };
	const { [conversationId]: _empty, ...rest } = map;
	return rest;
};

export const useChatMessageQueueStore = create<ChatMessageQueueStore>(
	(set, get) => {
		const takeFrom = (
			key: "queued" | "pending",
			conversationId: string,
			pick: (list: QueuedChatMessage[]) => number,
		): QueuedChatMessage | undefined => {
			const list = get()[key][conversationId] ?? [];
			const index = pick(list);
			const message = list[index];
			if (!message) return undefined;
			set((state) => ({
				[key]: withList(
					state[key],
					conversationId,
					(state[key][conversationId] ?? []).filter(
						(item) => item.id !== message.id,
					),
				),
			}));
			return message;
		};

		return {
			queued: {},
			pending: {},
			paused: {},

			enqueue: (conversationId, messages, position = "back") => {
				const added = Array.isArray(messages) ? messages : [messages];
				if (added.length === 0) return;
				set((state) => {
					const current = state.queued[conversationId] ?? [];
					return {
						queued: withList(
							state.queued,
							conversationId,
							position === "front"
								? [...added, ...current]
								: [...current, ...added],
						),
					};
				});
			},

			dequeue: (conversationId) => takeFrom("queued", conversationId, () => 0),

			remove: (conversationId, id) =>
				takeFrom("queued", conversationId, (list) =>
					list.findIndex((item) => item.id === id),
				),

			addPending: (conversationId, message) => {
				set((state) => ({
					pending: withList(state.pending, conversationId, [
						...(state.pending[conversationId] ?? []),
						message,
					]),
				}));
			},

			removePending: (conversationId, id) =>
				takeFrom("pending", conversationId, (list) =>
					list.findIndex((item) => item.id === id),
				),

			takePending: (conversationId) => {
				const taken = get().pending[conversationId] ?? [];
				if (taken.length > 0) {
					set((state) => ({
						pending: withList(state.pending, conversationId, []),
					}));
				}
				return taken;
			},

			setPaused: (conversationId, paused) => {
				set((state) => {
					if (Boolean(state.paused[conversationId]) === paused) return {};
					const { [conversationId]: _previous, ...rest } = state.paused;
					return {
						paused: paused ? { ...rest, [conversationId]: true } : rest,
					};
				});
			},
		};
	},
);
