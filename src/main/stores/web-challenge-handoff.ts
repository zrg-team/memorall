import { create } from "zustand";

/**
 * Carries a one-shot follow-up prompt from a tool-result card back to the chat.
 *
 * A tool call cannot block waiting for a person: by the time the "this page is a
 * bot wall" card is on screen, the agent's turn is over. So when the user has
 * solved the challenge and asks to continue, the card leaves the prompt here and
 * `ChatPage` — which owns `submitMessage` — picks it up and sends it.
 *
 * Deliberately its own tiny store rather than a field on the database-backed
 * chat store: nothing here should be persisted, and `ActionRenderer` gives tool
 * cards no callback channel to use instead.
 */
interface WebChallengeHandoffStore {
	pendingContinuation: string | null;
	requestContinuation: (prompt: string) => void;
	/** Returns the prompt and clears it, so it can only ever be sent once. */
	takeContinuation: () => string | null;
}

export const useWebChallengeHandoffStore = create<WebChallengeHandoffStore>(
	(set, get) => ({
		pendingContinuation: null,
		requestContinuation: (pendingContinuation) => set({ pendingContinuation }),
		takeContinuation: () => {
			const { pendingContinuation } = get();
			if (pendingContinuation === null) return null;
			set({ pendingContinuation: null });
			return pendingContinuation;
		},
	}),
);
