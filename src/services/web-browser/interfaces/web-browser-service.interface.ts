import type {
	ActiveWebSessionInfo,
	WebCancelChallengesArgs,
	WebFetchRenderedFallbackArgs,
	WebFetchRenderedFallbackResult,
	WebGetOrOpenSessionArgs,
	WebGetOrOpenSessionResult,
	WebOpenSessionArgs,
	WebOpenSessionResult,
	WebPerformDomActionArgs,
	WebQueryDomElementsArgs,
	WebRefreshSessionArgs,
	WebReloadSessionArgs,
	WebResolveChallengeArgs,
	WebSearchInSessionArgs,
	WebSearchMatch,
	WebSession,
	WebWaitForRenderArgs,
	WebWaitForSelectorArgs,
	WebWaitResult,
} from "../types";
import type {
	WebDomElementInfo,
	WebElementRecord,
} from "../web-browser-protocol";

export interface IWebBrowserService {
	isReady(): boolean;
	getInitializedAt(): number | null;
	initialize(): Promise<void>;
	dispose(): Promise<void>;
	openSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult>;
	refreshSession(args: WebRefreshSessionArgs): Promise<WebSession>;
	getOrOpenSession(
		args: WebGetOrOpenSessionArgs,
	): Promise<WebGetOrOpenSessionResult>;
	closeSession(sessionId: string): Promise<void>;
	/** Bring the session's page to the front for the user to act on. */
	focusSession(sessionId: string): Promise<void>;
	/** Reload the session's page and re-snapshot it, which re-runs block detection. */
	reloadSession(args: WebReloadSessionArgs): Promise<WebSession>;
	/**
	 * Answer a tool that is parked on a bot wall. Resolves false when nothing was
	 * waiting, so the card can say it expired rather than appearing to work.
	 */
	resolveChallenge(
		args: WebResolveChallengeArgs,
	): Promise<{ resolved: boolean }>;
	/** Release parked waits, for the Stop button and for a closed session. */
	cancelChallenges(
		args: WebCancelChallengesArgs,
	): Promise<{ cancelled: number }>;
	disposeActiveSession(reason?: string): Promise<void>;
	getActiveSessionInfo(): Promise<ActiveWebSessionInfo>;
	getAllSessionsInfo(): Promise<ActiveWebSessionInfo[]>;
	trimToLatestSession(): Promise<void>;
	fetchRenderedFallback(
		args: WebFetchRenderedFallbackArgs,
	): Promise<WebFetchRenderedFallbackResult>;
	queryDomElements(args: WebQueryDomElementsArgs): Promise<WebDomElementInfo[]>;
	searchInSessionHtml(args: WebSearchInSessionArgs): Promise<WebSearchMatch[]>;
	waitForDomSelector(args: WebWaitForSelectorArgs): Promise<WebWaitResult>;
	waitForPageRender(args: WebWaitForRenderArgs): Promise<WebWaitResult>;
	performDomAction(args: WebPerformDomActionArgs): Promise<WebElementRecord>;
}
