export type WebBrowserMode = "iframe" | "tab" | "window";

export interface WebSearchMatch {
	text: string;
	context?: string;
	index?: number;
}

export type IWebBrowserService = IFlowWebBrowserService;

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

export interface WebOpenSessionArgs {
	url?: string;
	mode?: WebBrowserMode;
	browserMode?: WebBrowserMode;
	timeoutMs?: number;
	maxHtmlChars?: number;
	persist?: boolean;
	sessionId?: string;
}

export interface WebOpenSessionResult {
	session: WebSession;
	disposable: boolean;
	renderReady?: boolean;
}

export interface WebRefreshSessionArgs {
	sessionId: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
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

export interface WebQueryDomArgs {
	sessionId: string;
	selector: string;
	maxResults?: number;
	maxHtmlChars?: number;
	timeoutMs?: number;
}

export interface WebDomActionArgs extends WebQueryDomArgs {
	action: string;
	value?: string;
	index?: number;
}

export interface WebWaitDomSelectorArgs extends WebQueryDomArgs {
	state?: "present" | "absent";
	timeoutMs?: number;
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

export interface IFlowWebBrowserService {
	isReady(): boolean;
	openSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult>;
	refreshSession(args: WebRefreshSessionArgs): Promise<WebSession>;
	getOrOpenSession(args: WebOpenSessionArgs): Promise<WebOpenSessionResult>;
	getAllSessionsInfo(): Promise<ActiveWebSessionInfo[]>;
	trimToLatestSession(): Promise<void>;
	closeSession(sessionId: string): Promise<void>;
	getActiveSessionInfo(): Promise<ActiveWebSessionInfo>;
	fetchRenderedFallback(
		args: WebRenderedFallbackArgs,
	): Promise<WebRenderedFallbackResult>;
	searchInSessionHtml(args: WebSearchInSessionArgs): Promise<WebSearchMatch[]>;
	queryDomElements(args: WebQueryDomArgs): Promise<WebDomElementInfo[]>;
	performDomAction(args: WebDomActionArgs): Promise<WebDomActionResult>;
	waitForDomSelector(args: WebWaitDomSelectorArgs): Promise<WebWaitResult>;
	waitForPageRender(
		args: WebRefreshSessionArgs & { intervalMs?: number; stabilityMs?: number },
	): Promise<WebWaitResult>;
}
