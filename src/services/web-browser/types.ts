import type {
	WebBrowserMode,
	WebDomActionName,
	WebDomElementInfo,
	WebElementRecord,
	WebWaitSelectorState,
} from "./web-browser-protocol";
import type { WebBlockSignal } from "@memorall/agent-harness-flows/tools/web/challenge-detection";

export interface WebSession {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	title: string;
	html: string;
	text: string;
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

export interface WebOpenSessionArgs {
	url: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
	persist?: boolean;
	mode?: WebBrowserMode;
}

export interface WebOpenSessionResult {
	session: WebSession;
	disposable: boolean;
	renderReady: boolean;
}

export interface WebRefreshSessionArgs {
	sessionId: string;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

export interface WebGetOrOpenSessionArgs {
	sessionId?: string;
	url?: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
	browserMode?: WebBrowserMode;
}

export interface WebGetOrOpenSessionResult {
	session: WebSession;
	disposable: boolean;
}

export interface WebFetchRenderedFallbackArgs {
	url: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
}

export interface WebFetchRenderedFallbackResult {
	title: string;
	html: string;
	text: string;
	currentUrl: string;
}

export interface WebSearchMatch {
	index: number;
	text: string;
	elementTag: string | null;
	elementIndex: number;
	snippet: string;
}

export interface WebSearchInSessionArgs {
	sessionId: string;
	pattern: string;
	selector?: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	maxMatches?: number;
	maxSnippetChars?: number;
}

export interface WebQueryDomElementsArgs {
	sessionId: string;
	selector: string;
	maxResults: number;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

export interface WebWaitResult {
	matched: boolean;
	html: string;
	lastText: string;
}

export interface WebWaitForSelectorArgs {
	sessionId: string;
	selector: string;
	state?: WebWaitSelectorState;
	timeoutMs?: number;
	intervalMs?: number;
	maxHtmlChars?: number;
}

export interface WebWaitForRenderArgs {
	sessionId: string;
	timeoutMs?: number;
	intervalMs?: number;
	stabilityMs?: number;
	maxHtmlChars?: number;
}

export interface WebPerformDomActionArgs {
	sessionId: string;
	action: WebDomActionName;
	selector: string;
	index?: number;
	value?: string;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

export type WebBrowserOperation =
	| "session.open"
	| "session.refresh"
	| "session.getOrOpen"
	| "session.close"
	| "session.disposeActive"
	| "session.getActiveInfo"
	| "session.getAllInfo"
	| "session.trimToLatest"
	| "content.fetchRenderedFallback"
	| "dom.query"
	| "dom.action"
	| "search.findInPage"
	| "wait.selector"
	| "wait.render";

export interface WebBrowserOperationPayloadMap {
	"session.open": WebOpenSessionArgs;
	"session.refresh": WebRefreshSessionArgs;
	"session.getOrOpen": WebGetOrOpenSessionArgs;
	"session.close": { sessionId: string };
	"session.disposeActive": { reason?: string } | undefined;
	"session.getActiveInfo": undefined;
	"session.getAllInfo": undefined;
	"session.trimToLatest": undefined;
	"content.fetchRenderedFallback": WebFetchRenderedFallbackArgs;
	"dom.query": WebQueryDomElementsArgs;
	"dom.action": WebPerformDomActionArgs;
	"search.findInPage": WebSearchInSessionArgs;
	"wait.selector": WebWaitForSelectorArgs;
	"wait.render": WebWaitForRenderArgs;
}

export interface WebBrowserOperationResultMap {
	"session.open": WebOpenSessionResult;
	"session.refresh": WebSession;
	"session.getOrOpen": WebGetOrOpenSessionResult;
	"session.close": { closed: true };
	"session.disposeActive": { disposed: true };
	"session.getActiveInfo": ActiveWebSessionInfo;
	"session.getAllInfo": ActiveWebSessionInfo[];
	"session.trimToLatest": { trimmed: true };
	"content.fetchRenderedFallback": WebFetchRenderedFallbackResult;
	"dom.query": WebDomElementInfo[];
	"dom.action": WebElementRecord;
	"search.findInPage": WebSearchMatch[];
	"wait.selector": WebWaitResult;
	"wait.render": WebWaitResult;
}

export const WEB_BROWSER_OPERATION_JOB_NAME = "web-browser-operation" as const;

export type WebBrowserOperationJobPayload = {
	[K in WebBrowserOperation]: {
		operation: K;
		payload: WebBrowserOperationPayloadMap[K];
	};
}[WebBrowserOperation];

export interface WebBrowserOperationJobResult extends Record<string, unknown> {
	operation: WebBrowserOperation;
	result: unknown;
}
