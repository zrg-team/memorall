/**
 * The agent picked last ("chat" for none), kept across reloads.
 *
 * One choice for every surface: the main chat writes it from its composer, and
 * the co-agent reads the same key, so it opens on the agent last used in chat.
 * Kept here rather than in the chat store so a content script can read it
 * without pulling in the store.
 */
export const SELECTED_AGENT_STORAGE_KEY = "memorall.chat.selectedAgent";
