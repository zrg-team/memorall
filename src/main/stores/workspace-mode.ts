import { create } from "zustand";
import { platform } from "@/platform/current";
import {
	isWorkspaceMode,
	type WorkspaceMode,
} from "@/services/llm/interfaces/model-category";

export const WORKSPACE_MODE_STORAGE_KEY = "memorall.workspace.mode";

/** Studios hand text to the chat composer (e.g. a transcript) with this event. */
export const CHAT_INSERT_TEXT_EVENT = "memorall:chat:insert-text";

interface WorkspaceModeState {
	/** What the main panel shows: chat, or one of the media studios. */
	mode: WorkspaceMode;
	hydrated: boolean;
	/**
	 * Text waiting for the chat composer. Held here because the composer is
	 * not mounted while a studio is open.
	 */
	pendingChatText: string | null;
	setMode: (mode: WorkspaceMode) => void;
	sendTextToChat: (text: string) => void;
	takePendingChatText: () => string | null;
	hydrate: () => Promise<void>;
}

/**
 * The main panel follows the kind of model the user picked last: choosing a
 * speech model opens the speech studio, choosing a chat model returns to
 * chat. Persisted so a reload lands where the user left off.
 */
export const useWorkspaceModeStore = create<WorkspaceModeState>((set, get) => ({
	mode: "chat",
	hydrated: false,
	pendingChatText: null,
	sendTextToChat: (text) => {
		set({ pendingChatText: text });
		get().setMode("chat");
	},
	takePendingChatText: () => {
		const text = get().pendingChatText;
		if (text !== null) set({ pendingChatText: null });
		return text;
	},
	setMode: (mode) => {
		if (get().mode === mode) return;
		set({ mode });
		void platform.persistentStore
			.set(WORKSPACE_MODE_STORAGE_KEY, mode)
			.catch(() => undefined);
	},
	hydrate: async () => {
		if (get().hydrated) return;
		try {
			const stored = await platform.persistentStore.get<string>(
				WORKSPACE_MODE_STORAGE_KEY,
			);
			set({
				hydrated: true,
				...(isWorkspaceMode(stored) ? { mode: stored } : {}),
			});
		} catch {
			set({ hydrated: true });
		}
	},
}));
