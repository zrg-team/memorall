import { and, desc, eq, inArray } from "drizzle-orm";
import { create } from "zustand";
import { serviceManager } from "@/services";
import type { Conversation, Message } from "@/services/database/types";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import {
	STUDIO_MESSAGE_TYPES,
	type StudioContentPart,
	type StudioGenerationMetadata,
	type StudioItem,
} from "@/types/studio";
import { logError } from "@/utils/logger";
import { sanitizeForJson } from "@/utils/sanitize-json";
import { v4 } from "@/utils/uuid";

const HISTORY_LIMIT = 50;

/**
 * Generations running in this page. A stored item still marked "running" that
 * is not in here was interrupted - the tab closed or reloaded mid-run - and is
 * shown as failed rather than spinning forever.
 */
const activeGenerations = new Set<string>();

export const markGenerationActive = (id: string, active: boolean) => {
	if (active) activeGenerations.add(id);
	else activeGenerations.delete(id);
};
const ITEM_LIMIT = 200;

interface StudioModeState {
	conversations: Conversation[];
	currentConversationId: string | null;
	items: StudioItem[];
	loaded: boolean;
}

const emptyModeState = (): StudioModeState => ({
	conversations: [],
	currentConversationId: null,
	items: [],
	loaded: false,
});

export interface NewStudioItem {
	content: string;
	parts: StudioContentPart[];
	generation: StudioGenerationMetadata;
}

interface StudioStore {
	modes: Partial<Record<MediaCategory, StudioModeState>>;
	/** Load the session list and open the newest session (or none). */
	loadMode: (mode: MediaCategory) => Promise<void>;
	openConversation: (mode: MediaCategory, id: string) => Promise<void>;
	/** Start an empty session; the first generation gives it a title. */
	newConversation: (mode: MediaCategory) => void;
	renameConversation: (
		mode: MediaCategory,
		id: string,
		title: string,
	) => Promise<void>;
	togglePinned: (mode: MediaCategory, id: string) => Promise<void>;
	deleteConversation: (mode: MediaCategory, id: string) => Promise<void>;
	/** Persist a generation, creating the session on first use. */
	addItem: (mode: MediaCategory, item: NewStudioItem) => Promise<StudioItem>;
	/** Merge into an item that is still running (status, parts, text). */
	updateItem: (
		mode: MediaCategory,
		id: string,
		update: Partial<NewStudioItem>,
	) => Promise<void>;
	deleteItem: (mode: MediaCategory, id: string) => Promise<void>;
}

/** Documents-filesystem paths of the media a generation stored. */
export const mediaPathsOf = (parts: readonly StudioContentPart[]): string[] =>
	parts.flatMap((part) => {
		switch (part.type) {
			case "input_audio":
				return [part.input_audio.path];
			case "output_audio":
				return [part.output_audio.path];
			case "image":
				return [part.image.path];
			default:
				return [];
		}
	});

/**
 * Remove stored media once nothing references it. Best effort: a file that is
 * already gone, or a filesystem that is not ready, must not block a delete.
 */
async function deleteMediaFiles(paths: readonly string[]): Promise<void> {
	if (paths.length === 0) return;
	const [{ documentFileSystemService }, { toDocumentsSandboxPath }] =
		await Promise.all([
			import("@/services/filesystem/document-filesystem"),
			import("@/services/filesystem/sandbox-paths"),
		]);
	await Promise.all(
		[...new Set(paths)].map((path) =>
			documentFileSystemService
				.deleteFile(toDocumentsSandboxPath(path))
				.catch(() => undefined),
		),
	);
}

async function mediaPathsInRows(
	where: "conversation" | "message",
	id: string,
): Promise<string[]> {
	const rows = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({ complexContent: schema.messages.complexContent })
			.from(schema.messages)
			.where(
				where === "conversation"
					? eq(schema.messages.conversationId, id)
					: eq(schema.messages.id, id),
			),
	);
	return rows.flatMap((row) =>
		Array.isArray(row.complexContent)
			? mediaPathsOf(row.complexContent as StudioContentPart[])
			: [],
	);
}

const metadataOf = (conversation: Conversation): Record<string, unknown> =>
	conversation.metadata && typeof conversation.metadata === "object"
		? (conversation.metadata as Record<string, unknown>)
		: {};

const titleFrom = (text: string): string => {
	const clean = text.replace(/\s+/g, " ").trim();
	if (!clean) return "Untitled";
	return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean;
};

export const toStudioItem = (
	mode: MediaCategory,
	message: Message,
): StudioItem | null => {
	const metadata = (message.metadata ?? {}) as Record<string, unknown>;
	const stored = metadata.generation as StudioGenerationMetadata | undefined;
	if (!stored) return null;
	const generation: StudioGenerationMetadata =
		stored.status === "running" && !activeGenerations.has(message.id)
			? {
					...stored,
					status: "failed",
					error: stored.error ?? "Interrupted before it finished",
				}
			: stored;
	return {
		id: message.id,
		conversationId: message.conversationId,
		category: mode,
		content: message.content,
		parts: Array.isArray(message.complexContent)
			? (message.complexContent as StudioContentPart[])
			: [],
		generation,
		createdAt: new Date(message.createdAt),
	};
};

/**
 * History for the media studios.
 *
 * Studios reuse the conversations and messages tables - a session is a
 * conversation with `mode` set, a generation is one message whose type names
 * the studio - so sessions survive reloads and sync like chats do. Each mode
 * keeps its own list; nothing here touches the chat store.
 */
export const useStudioStore = create<StudioStore>((set, get) => {
	const modeState = (mode: MediaCategory): StudioModeState =>
		get().modes[mode] ?? emptyModeState();

	const patchMode = (
		mode: MediaCategory,
		patch: (state: StudioModeState) => Partial<StudioModeState>,
	) =>
		set((store) => {
			const current = store.modes[mode] ?? emptyModeState();
			return {
				modes: { ...store.modes, [mode]: { ...current, ...patch(current) } },
			};
		});

	const loadItems = async (mode: MediaCategory, conversationId: string) => {
		const rows = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.messages)
				.where(
					and(
						eq(schema.messages.conversationId, conversationId),
						eq(schema.messages.type, STUDIO_MESSAGE_TYPES[mode]),
					),
				)
				.orderBy(desc(schema.messages.createdAt))
				.limit(ITEM_LIMIT),
		);
		return rows
			.map((row) => toStudioItem(mode, row))
			.filter((item): item is StudioItem => item !== null)
			.reverse();
	};

	const touchConversation = async (
		mode: MediaCategory,
		conversation: Conversation,
		preview: string,
	) => {
		const updatedAt = new Date();
		const metadata = {
			...metadataOf(conversation),
			lastMessagePreview: titleFrom(preview),
		};
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.update(schema.conversations)
				.set({ metadata, updatedAt })
				.where(eq(schema.conversations.id, conversation.id)),
		);
		patchMode(mode, (state) => ({
			conversations: [
				{ ...conversation, metadata, updatedAt },
				...state.conversations.filter((item) => item.id !== conversation.id),
			],
		}));
	};

	return {
		modes: {},

		loadMode: async (mode) => {
			try {
				const conversations = await serviceManager.databaseService.use(
					({ db, schema }) =>
						db
							.select()
							.from(schema.conversations)
							.where(eq(schema.conversations.mode, mode))
							.orderBy(desc(schema.conversations.updatedAt))
							.limit(HISTORY_LIMIT),
				);
				const previous = modeState(mode);
				const currentId =
					previous.currentConversationId &&
					conversations.some(
						(item) => item.id === previous.currentConversationId,
					)
						? previous.currentConversationId
						: (conversations[0]?.id ?? null);
				const items = currentId ? await loadItems(mode, currentId) : [];
				patchMode(mode, () => ({
					conversations,
					currentConversationId: currentId,
					items,
					loaded: true,
				}));
			} catch (error) {
				logError(`Failed to load ${mode} studio history:`, error);
				patchMode(mode, () => ({ loaded: true }));
			}
		},

		openConversation: async (mode, id) => {
			patchMode(mode, () => ({ currentConversationId: id, items: [] }));
			try {
				const items = await loadItems(mode, id);
				if (modeState(mode).currentConversationId === id) {
					patchMode(mode, () => ({ items }));
				}
			} catch (error) {
				logError("Failed to open studio session:", error);
			}
		},

		newConversation: (mode) => {
			patchMode(mode, () => ({ currentConversationId: null, items: [] }));
		},

		renameConversation: async (mode, id, title) => {
			const next = title.trim();
			if (!next) return;
			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.conversations)
					.set({ title: next })
					.where(eq(schema.conversations.id, id)),
			);
			patchMode(mode, (state) => ({
				conversations: state.conversations.map((item) =>
					item.id === id ? { ...item, title: next } : item,
				),
			}));
		},

		togglePinned: async (mode, id) => {
			const conversation = modeState(mode).conversations.find(
				(item) => item.id === id,
			);
			if (!conversation) return;
			const metadata = metadataOf(conversation);
			const nextMetadata = { ...metadata, pinned: metadata.pinned !== true };
			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.conversations)
					.set({ metadata: nextMetadata })
					.where(eq(schema.conversations.id, id)),
			);
			patchMode(mode, (state) => ({
				conversations: state.conversations.map((item) =>
					item.id === id ? { ...item, metadata: nextMetadata } : item,
				),
			}));
		},

		deleteConversation: async (mode, id) => {
			try {
				const mediaPaths = await mediaPathsInRows("conversation", id).catch(
					() => [] as string[],
				);
				await serviceManager.databaseService.use(async ({ db, schema }) => {
					await db
						.delete(schema.messages)
						.where(eq(schema.messages.conversationId, id));
					await db
						.delete(schema.conversations)
						.where(eq(schema.conversations.id, id));
				});
				void deleteMediaFiles(mediaPaths);
				const wasCurrent = modeState(mode).currentConversationId === id;
				patchMode(mode, (state) => ({
					conversations: state.conversations.filter((item) => item.id !== id),
				}));
				if (wasCurrent) {
					const next = modeState(mode).conversations[0];
					if (next) {
						await get().openConversation(mode, next.id);
					} else {
						get().newConversation(mode);
					}
				}
			} catch (error) {
				logError("Failed to delete studio session:", error);
				throw error;
			}
		},

		addItem: async (mode, item) => {
			let state = modeState(mode);
			let conversation = state.conversations.find(
				(entry) => entry.id === state.currentConversationId,
			);

			if (!conversation) {
				conversation = await serviceManager.databaseService.use(
					async ({ db, schema }) => {
						const [created] = await db
							.insert(schema.conversations)
							.values({
								title: titleFrom(item.content),
								mode,
								metadata: { createdAt: new Date().toISOString() },
							})
							.returning();
						return created;
					},
				);
				const created = conversation;
				patchMode(mode, (current) => ({
					conversations: [created, ...current.conversations],
					currentConversationId: created.id,
					items: [],
				}));
				state = modeState(mode);
			}

			const now = new Date();
			const row = {
				id: v4(),
				conversationId: conversation.id,
				type: STUDIO_MESSAGE_TYPES[mode],
				role: "assistant",
				content: item.content,
				complexContent: sanitizeForJson(item.parts) as unknown,
				metadata: sanitizeForJson({ generation: item.generation }) as Record<
					string,
					unknown
				>,
				createdAt: now,
				updatedAt: now,
			};
			await serviceManager.databaseService.use(({ db, schema }) =>
				db.insert(schema.messages).values(row),
			);

			const studioItem: StudioItem = {
				id: row.id,
				conversationId: conversation.id,
				category: mode,
				content: item.content,
				parts: item.parts,
				generation: item.generation,
				createdAt: now,
			};
			patchMode(mode, (current) => ({
				items:
					current.currentConversationId === conversation.id
						? [...current.items, studioItem]
						: current.items,
			}));
			await touchConversation(mode, conversation, item.content).catch((error) =>
				logError("Failed to update studio session:", error),
			);
			return studioItem;
		},

		updateItem: async (mode, id, update) => {
			// The session on screen may have changed since the generation started;
			// the update is still written, only the visible list is left alone.
			const existing = modeState(mode).items.find((item) => item.id === id);
			if (existing) {
				const next: StudioItem = {
					...existing,
					content: update.content ?? existing.content,
					parts: update.parts ?? existing.parts,
					generation: update.generation ?? existing.generation,
				};
				patchMode(mode, (state) => ({
					items: state.items.map((item) => (item.id === id ? next : item)),
				}));
			}
			const changes: Record<string, unknown> = { updatedAt: new Date() };
			if (update.content !== undefined) changes.content = update.content;
			if (update.parts !== undefined) {
				changes.complexContent = sanitizeForJson(update.parts);
			}
			if (update.generation !== undefined) {
				changes.metadata = sanitizeForJson({ generation: update.generation });
			}
			try {
				await serviceManager.databaseService.use(({ db, schema }) =>
					db
						.update(schema.messages)
						.set(changes)
						.where(eq(schema.messages.id, id)),
				);
			} catch (error) {
				logError("Failed to update studio generation:", error);
			}
		},

		deleteItem: async (mode, id) => {
			patchMode(mode, (state) => ({
				items: state.items.filter((item) => item.id !== id),
			}));
			try {
				const mediaPaths = await mediaPathsInRows("message", id).catch(
					() => [] as string[],
				);
				await serviceManager.databaseService.use(({ db, schema }) =>
					db.delete(schema.messages).where(inArray(schema.messages.id, [id])),
				);
				void deleteMediaFiles(mediaPaths);
			} catch (error) {
				logError("Failed to delete studio generation:", error);
			}
		},
	};
});
