import { create } from "zustand";

import {
	subscribeToChallengePrompts,
	type WebChallengeDecision,
	type WebChallengePrompt,
} from "@/services/web-browser/challenge-intervention";
import { logError } from "@/utils/logger";

/**
 * The bot walls a running tool is currently parked on, waiting for the user.
 *
 * Prompts are published by the tool into session storage rather than pushed
 * through the chat stream, which is what lets this survive a remount: a user who
 * closes and reopens the side panel while solving a CAPTCHA gets the same card
 * back, still able to answer it. The answer travels the other way, through the
 * web-browser background job, so a button learns whether the wait was still
 * there rather than appearing to work.
 *
 * Every service and platform touch is behind a dynamic import. This store is
 * reachable from the assistant tool timeline, and a static import would drag the
 * whole service tree, pdf.js included, into any test that renders a message.
 */
interface HandoffResult {
	/** Set when the handoff had to reopen the page under a new session. */
	replacement?: { sessionId: string; tabId?: number };
}

interface WebChallengePromptStore {
	prompts: WebChallengePrompt[];
	/** Idempotent: safe to call from every mount. */
	start: () => void;
	/** Raise the page so the user can clear the wall themselves. */
	handOver: (
		prompt: WebChallengePrompt,
		sessionId: string,
		tabId: number | undefined,
		confirmVisibleRestart: () => boolean,
	) => Promise<HandoffResult>;
	/** Reload the page and report whether the wall is gone. */
	reloadAndCheck: (sessionId: string) => Promise<{ cleared: boolean }>;
	/** Returns false when the wait had already expired or been cancelled. */
	resolve: (
		promptId: string,
		decision: WebChallengeDecision,
	) => Promise<boolean>;
	cancelAll: () => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

const webBrowserService = async () => {
	const { serviceManager } = await import("@/services");
	return serviceManager.getWebBrowserService();
};

export const useWebChallengePromptStore = create<WebChallengePromptStore>(
	(set) => ({
		prompts: [],

		start: () => {
			if (unsubscribe) return;
			try {
				unsubscribe = subscribeToChallengePrompts((prompts) =>
					set({ prompts }),
				);
			} catch (error) {
				// A surface without session storage simply never shows a card.
				logError("Web challenge prompt subscription failed:", error);
			}
		},

		handOver: async (prompt, sessionId, tabId, confirmVisibleRestart) => {
			const { platform } = await import("@/platform/current");
			const automation = platform.browserAutomation;
			const service = await webBrowserService();

			if (!automation) {
				await service.focusSession(sessionId);
				return {};
			}

			const status = automation.getSnapshot();
			if (status.visible) {
				if (typeof tabId !== "number") {
					throw new Error("This session has no browser tab to hand over.");
				}
				await automation.takeover(tabId);
				return {};
			}

			// Making the managed browser visible restarts it and closes every
			// session, so the page has to be reopened and the retry re-pointed at
			// whatever session replaces this one.
			if (!confirmVisibleRestart()) return {};
			await automation.configure({
				visible: true,
				persistProfile: status.persistProfile,
			});
			const reopened = await service.openSession({
				url: prompt.url,
				mode: "window",
				persist: true,
			});
			const reopenedTabId = reopened.session.tabId;
			if (typeof reopenedTabId !== "number") {
				throw new Error("The reopened page has no browser tab to hand over.");
			}
			await automation.takeover(reopenedTabId);
			return {
				replacement: { sessionId: reopened.session.id, tabId: reopenedTabId },
			};
		},

		reloadAndCheck: async (sessionId) => {
			const service = await webBrowserService();
			const session = await service.reloadSession({ sessionId });
			return { cleared: !session.block };
		},

		resolve: async (promptId, decision) => {
			try {
				const service = await webBrowserService();
				const { resolved } = await service.resolveChallenge({
					promptId,
					decision,
				});
				return resolved;
			} catch (error) {
				logError("Web challenge resolve failed:", error);
				return false;
			}
		},

		cancelAll: async () => {
			try {
				const service = await webBrowserService();
				await service.cancelChallenges({ all: true });
			} catch (error) {
				logError("Web challenge cancel failed:", error);
			}
		},
	}),
);
