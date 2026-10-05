import {
	WEB_SESSION_EVENT_SOURCE,
	type WebPageAction,
	type WebSessionEvent,
	type WebSessionEventMessage,
} from "@/services/web-browser/web-browser-protocol";

/** After the agent navigates a tab, what the tab does next is still its doing. */
export const AGENT_NAVIGATION_GRACE_MS = 1_500;
/** An agent's click can start a navigation well after the click returns. */
export const AGENT_ACTION_GRACE_MS = 5_000;

export interface WebSessionEventDeps {
	/** The web session a tab belongs to, if any. */
	sessionIdForTab(tabId: number): Promise<string | null>;
	/** The tab is gone: the session no longer has one. */
	forgetSession(sessionId: string): Promise<void>;
	/** Delivers the event to wherever the sessions live. */
	send(message: WebSessionEventMessage): void;
	now?: () => number;
}

/** The parts of a `chrome.webNavigation` event this reads. */
export interface WebNavigationDetails {
	tabId: number;
	frameId: number;
	url: string;
	transitionType?: string;
}

/**
 * What a web session's tab does that the agent did not: the person using it
 * navigates, reloads, clicks, submits a form or closes it. The agent's own
 * commands on a tab are bracketed by `whileAgentDrives`, and whatever the tab
 * does meanwhile (and shortly after) is not reported.
 */
export const createWebSessionEvents = (deps: WebSessionEventDeps) => {
	const now = deps.now ?? Date.now;
	const driving = new Map<number, number>();
	const graceUntil = new Map<number, number>();

	const agentDriving = (tabId: number): boolean =>
		(driving.get(tabId) ?? 0) > 0 || (graceUntil.get(tabId) ?? 0) > now();

	const forward = async (tabId: number, event: WebSessionEvent) => {
		const sessionId = await deps.sessionIdForTab(tabId);
		if (!sessionId) return;
		deps.send({ source: WEB_SESSION_EVENT_SOURCE, sessionId, event });
	};

	const markAgent = (tabId: number, graceMs: number): void => {
		graceUntil.set(
			tabId,
			Math.max(graceUntil.get(tabId) ?? 0, now() + graceMs),
		);
	};

	const navigated = (details: WebNavigationDetails, reload: boolean) => {
		// Frames are part of the page; only the tab's own document moves it.
		if (details.frameId !== 0 || agentDriving(details.tabId)) return;
		void forward(details.tabId, {
			kind: "navigated",
			url: details.url,
			reload,
		});
	};

	return {
		/** Marks the tab as the agent's for `graceMs` from now. */
		markAgent,

		/** Runs a command of the agent's on a tab. */
		async whileAgentDrives<T>(
			tabId: number,
			graceMs: number,
			run: () => Promise<T>,
		): Promise<T> {
			driving.set(tabId, (driving.get(tabId) ?? 0) + 1);
			try {
				return await run();
			} finally {
				const left = (driving.get(tabId) ?? 1) - 1;
				if (left > 0) driving.set(tabId, left);
				else driving.delete(tabId);
				markAgent(tabId, graceMs);
			}
		},

		/** A new document committed: a navigation, or a reload. */
		onCommitted(details: WebNavigationDetails): void {
			navigated(details, details.transitionType === "reload");
		},

		/** The page changed its address itself (a single-page app's route). */
		onHistoryStateUpdated(details: WebNavigationDetails): void {
			navigated(details, false);
		},

		/** A click or a form submission the page reported. */
		onPageAction(tabId: number, action: WebPageAction): void {
			void forward(tabId, action);
		},

		onTabRemoved(tabId: number): void {
			const byAgent = agentDriving(tabId);
			driving.delete(tabId);
			graceUntil.delete(tabId);
			void (async () => {
				const sessionId = await deps.sessionIdForTab(tabId);
				if (!sessionId) return;
				if (!byAgent) {
					deps.send({
						source: WEB_SESSION_EVENT_SOURCE,
						sessionId,
						event: { kind: "closed" },
					});
				}
				await deps.forgetSession(sessionId);
			})();
		},
	};
};

export type WebSessionEvents = ReturnType<typeof createWebSessionEvents>;
