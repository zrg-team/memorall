import type {
	ActiveWebSessionInfo,
	WebFetchRenderedFallbackArgs,
	WebFetchRenderedFallbackResult,
	WebGetOrOpenSessionArgs,
	WebGetOrOpenSessionResult,
	WebOpenSessionArgs,
	WebOpenSessionResult,
	WebPerformDomActionArgs,
	WebQueryDomElementsArgs,
	WebRefreshSessionArgs,
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
