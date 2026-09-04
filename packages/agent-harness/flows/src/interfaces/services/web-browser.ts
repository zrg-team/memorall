import type { WebBlockSignal } from "../../tools/web/challenge-detection.js";
export type WebBrowserMode = "iframe" | "tab" | "window";
export type WebSelectorState = "present" | "absent";
export type WebDomActionName =
	| "read"
	| "click"
	| "input"
	| "focus"
	| "scrollBottom"
	| "scrollTop";

export interface WebBrowserCapabilities {
	canOpenSession: boolean;
	canQueryDom: boolean;
	canPerformDomAction: boolean;
	canWaitForDom: boolean;
	canWaitForRender: boolean;
	canFetchRenderedFallback: boolean;
	canManageMultipleSessions: boolean;
	/** Reload a session's page rather than only re-reading its DOM. */
	canReloadSession?: boolean;
	/** Park a blocked tool and ask the user to clear the wall themselves. */
	canAwaitUserIntervention?: boolean;
}

/** What the user chose when a tool asked them to clear a bot wall. */
export interface WebChallengeResolution {
	outcome: "retry" | "skip" | "cancel";
	/** The session the user actually solved, which a handoff can change. */
	sessionId?: string;
	tabId?: number;
}

export interface WebAwaitChallengeArgs {
	sessionId: string;
	tool: string;
	toolCallId?: string;
}

export interface WebSearchMatch {
	text: string;
	context?: string;
	index?: number;
}

export interface WebDomElement {
	text: string;
	html: string;
	attributes: Record<string, string>;
}

export interface WebSessionInfo {
	sessionId: string;
	id?: string;
	url: string;
	title?: string;
}

export interface WebSessionRef {
	sessionId: string;
}

export interface ActiveWebSessionInfo {
	isOpen: boolean;
	sessionId?: string;
	requestedUrl?: string;
	currentUrl?: string;
	title?: string;
	lastAccessedAt?: number;
	createdAt?: number;
	mode?: WebBrowserMode;
}

export interface WebSession {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	url?: string;
	title: string;
	html: string;
	text: string;
	lastText?: string;
	domAccessible: boolean;
	/**
	 * Set when the page turned out to be a bot wall (CAPTCHA, Cloudflare, rate
	 * limit, login gate) rather than the requested content. Derived once when the
	 * snapshot is applied, so every tool agrees on the verdict.
	 */
	block?: WebBlockSignal | null;
	/** The last snapshot attempt failed; this content is the previous capture. */
	stale?: boolean;
	/**
	 * Transport handle for the page: a browser tab id on the extension, a logical
	 * session id on the desktop sidecar. Needed to hand the page to the user.
	 */
	tabId?: number;
	windowId?: number;
	lastAccessedAt: number;
	createdAt: number;
	mode: WebBrowserMode;
}

export interface WebDomElementInfo {
	index?: number;
	tagName?: string;
	id?: string | null;
	name?: string | null;
	type?: string | null;
	placeholder?: string | null;
	ariaLabel?: string | null;
	title?: string | null;
	role?: string | null;
	text: string;
	value?: string | null;
	href?: string | null;
	disabled?: boolean;
	visible?: boolean;
	acceptsTextInput?: boolean;
	html?: string;
	attributes?: Record<string, string>;
}

export interface WebBrowserRequestOptions {
	timeoutMs?: number;
	maxHtmlChars?: number;
}

export interface WebOpenSessionArgs extends WebBrowserRequestOptions {
	url?: string;
	mode?: WebBrowserMode;
	browserMode?: WebBrowserMode;
	persist?: boolean;
	sessionId?: string;
}

export interface WebOpenSessionResult {
	session: WebSession;
	disposable: boolean;
	renderReady?: boolean;
}

export interface WebRefreshSessionArgs
	extends WebSessionRef,
		WebBrowserRequestOptions {}

export interface WebSearchInSessionArgs extends WebSessionRef {
	pattern: string;
	selector?: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	maxMatches?: number;
	maxSnippetChars?: number;
}

export interface WebQueryDomArgs
	extends WebSessionRef,
		WebBrowserRequestOptions {
	selector: string;
	maxResults?: number;
}

export interface WebDomActionArgs extends WebQueryDomArgs {
	action: WebDomActionName;
	value?: string;
	index?: number;
}

export interface WebWaitDomSelectorArgs extends WebQueryDomArgs {
	state?: WebSelectorState;
	intervalMs?: number;
}

export interface WebRenderedFallbackArgs {
	url: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
}

export interface WebRenderedFallbackResult {
	title: string;
	html: string;
	text: string;
	currentUrl: string;
}

export interface WebDomActionResult {
	matched?: boolean;
	html?: string;
	lastText?: string;
	result?: WebDomElementInfo | WebElementRecord;
}

export interface WebElementRecord {
	index?: number;
	label: string | null;
	text: string;
	value: string | null;
}

export interface WebWaitResult {
	matched: boolean;
	html: string;
	lastText: string;
}

export interface IFlowWebBrowserLifecycleService {
	isReady(): boolean;
	getCapabilities?(): WebBrowserCapabilities;
}

export interface IFlowWebBrowserSessionService {
	openSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult>;
	refreshSession(args: WebRefreshSessionArgs): Promise<WebSession>;
	getOrOpenSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult>;
	getAllSessionsInfo(): Promise<ActiveWebSessionInfo[]>;
	trimToLatestSession(): Promise<void>;
	closeSession(sessionId: string): Promise<void>;
	getActiveSessionInfo(): Promise<ActiveWebSessionInfo>;
}

export interface IFlowWebBrowserInterventionService {
	/**
	 * Reload the page and snapshot it again, which re-runs block detection.
	 * Absent on backends that cannot reload, such as the desktop direct backend.
	 */
	reloadSession?(args: WebRefreshSessionArgs): Promise<WebSession>;
	/**
	 * Publish the wall to the user and wait for their answer. Absent wherever the
	 * handoff cannot work, in which case tools report the wall as before.
	 */
	awaitChallengeResolution?(
		args: WebAwaitChallengeArgs,
	): Promise<WebChallengeResolution>;
}

export interface IFlowWebBrowserContentService {
	fetchRenderedFallback(
		args: WebRenderedFallbackArgs,
	): Promise<WebRenderedFallbackResult>;
	searchInSessionHtml(args: WebSearchInSessionArgs): Promise<WebSearchMatch[]>;
	waitForPageRender(
		args: WebRefreshSessionArgs & { intervalMs?: number; stabilityMs?: number },
	): Promise<WebWaitResult>;
}

export interface IFlowWebBrowserDomService {
	queryDomElements(args: WebQueryDomArgs): Promise<WebDomElementInfo[]>;
	performDomAction(args: WebDomActionArgs): Promise<WebDomActionResult>;
	waitForDomSelector(args: WebWaitDomSelectorArgs): Promise<WebWaitResult>;
}

export interface IFlowWebBrowserService
	extends IFlowWebBrowserLifecycleService,
		IFlowWebBrowserSessionService,
		IFlowWebBrowserContentService,
		IFlowWebBrowserInterventionService,
		IFlowWebBrowserDomService {}

declare global {
	interface ServiceRegistry {
		webBrowser?: IFlowWebBrowserService;
	}
}
