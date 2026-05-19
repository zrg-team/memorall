import {
	WEB_BROWSER_COMMAND_SOURCE,
	isWebBrowserCommandResponse,
	type WebBrowserCommandRequest,
	type WebBrowserCommandResponse,
	type WebBrowserMode,
	type WebDomActionName,
	type WebDomElementInfo,
	type WebElementRecord,
	type WebSnapshotPayload,
	type WebWaitSelectorState,
} from "./web-browser-protocol";
import { DEFAULT_WEB_MAX_HTML_CHARS } from "@/services/web-browser/max-html-chars";

interface WebSessionState {
	id: string;
	requestedUrl: string;
	currentUrl: string;
	title: string;
	html: string;
	text: string;
	domAccessible: boolean;
	lastAccessedAt: number;
	createdAt: number;
	mode: WebBrowserMode;
	iframe?: HTMLIFrameElement;
	tabId?: number;
	windowId?: number;
}

interface OpenSessionArgs {
	url: string;
	timeoutMs: number;
	maxHtmlChars: number;
	persist: boolean;
	mode?: WebBrowserMode;
}

interface OpenSessionResult {
	session: WebSessionState;
	disposable: boolean;
	renderReady: boolean;
}

interface SearchMatch {
	index: number;
	text: string;
	elementTag: string | null;
	elementIndex: number;
	snippet: string;
}

interface SearchPatternMatch {
	index: number;
}

interface ActiveWebSessionInfo {
	isOpen: boolean;
	sessionId?: string;
	requestedUrl?: string;
	currentUrl?: string;
	title?: string;
	lastAccessedAt?: number;
	createdAt?: number;
	mode?: WebBrowserMode;
}

type SuccessfulWebBrowserCommandResponse = Extract<
	WebBrowserCommandResponse,
	{ success: true }
>;

const WEB_SESSIONS = new Map<string, WebSessionState>();
const SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_HTML_CHARS = DEFAULT_WEB_MAX_HTML_CHARS;
const DEFAULT_POLL_INTERVAL_MS = 250;
const sessionTimeouts = new Map<string, number>();

// ─── Session persistence ──────────────────────────────────────────────────────
// Browser-backed (tab/window) session identifiers are written to
// chrome.storage.session so they can be recovered if the offscreen document
// is recreated (which clears the in-memory WEB_SESSIONS map).

const PERSISTED_SESSIONS_KEY = "memorall.web-sessions.v1";

interface PersistedSessionEntry {
	id: string;
	tabId: number;
	windowId?: number;
	mode: WebBrowserMode;
	requestedUrl: string;
}

const getSessionStorage = (): chrome.storage.StorageArea | null => {
	try {
		return (typeof chrome !== "undefined" && chrome.storage?.session) || null;
	} catch {
		return null;
	}
};

const loadPersistedSessionEntries = async (): Promise<
	Map<string, PersistedSessionEntry>
> => {
	const storage = getSessionStorage();
	if (!storage) return new Map();
	try {
		const result = await storage.get(PERSISTED_SESSIONS_KEY);
		const raw = result[PERSISTED_SESSIONS_KEY];
		const entries: PersistedSessionEntry[] = Array.isArray(raw) ? raw : [];
		return new Map(entries.map((e) => [e.id, e]));
	} catch {
		return new Map();
	}
};

const savePersistedSessionEntries = async (
	entries: Map<string, PersistedSessionEntry>,
): Promise<void> => {
	const storage = getSessionStorage();
	if (!storage) return;
	try {
		const arr = Array.from(entries.values());
		if (arr.length === 0) {
			await storage.remove(PERSISTED_SESSIONS_KEY);
		} else {
			await storage.set({ [PERSISTED_SESSIONS_KEY]: arr });
		}
	} catch {
		// Storage write is best-effort; don't break the session flow.
	}
};

const persistSession = (session: WebSessionState): void => {
	if (session.mode === "iframe" || typeof session.tabId !== "number") return;
	void loadPersistedSessionEntries().then((entries) => {
		entries.set(session.id, {
			id: session.id,
			tabId: session.tabId!,
			windowId: session.windowId,
			mode: session.mode,
			requestedUrl: session.requestedUrl,
		});
		void savePersistedSessionEntries(entries);
	});
};

const unpersistSession = (sessionId: string): void => {
	void loadPersistedSessionEntries().then((entries) => {
		if (entries.has(sessionId)) {
			entries.delete(sessionId);
			void savePersistedSessionEntries(entries);
		}
	});
};

/**
 * Attempt to recover a browser-backed session from chrome.storage.session.
 * Called when a sessionId is not found in the in-memory WEB_SESSIONS map
 * (e.g. after the offscreen document was recreated).
 * Returns the reconstructed session (with empty cached content) or null if
 * no persisted entry exists for the given id.
 */
const recoverSession = async (
	sessionId: string,
): Promise<WebSessionState | null> => {
	const entries = await loadPersistedSessionEntries();
	const entry = entries.get(sessionId);
	if (!entry || entry.mode === "iframe") return null;

	// Check that the tab still exists before reconstructing the session.
	try {
		await chrome.tabs.get(entry.tabId);
	} catch {
		// Tab was closed — remove the stale persisted entry.
		entries.delete(sessionId);
		void savePersistedSessionEntries(entries);
		return null;
	}

	const session: WebSessionState = {
		id: entry.id,
		requestedUrl: entry.requestedUrl,
		currentUrl: entry.requestedUrl,
		title: "",
		html: "",
		text: "",
		domAccessible: false,
		lastAccessedAt: Date.now(),
		createdAt: Date.now(),
		mode: entry.mode,
		tabId: entry.tabId,
		windowId: entry.windowId,
	};
	WEB_SESSIONS.set(sessionId, session);
	scheduleInactivityClose(sessionId);
	return session;
};

const buildIframe = (url: string): HTMLIFrameElement => {
	const iframe = document.createElement("iframe");
	iframe.style.cssText =
		"position:fixed;top:-9999px;left:-9999px;width:1280px;height:800px;opacity:0;pointer-events:none;";
	iframe.src = url;
	return iframe;
};

const normalizeInputUrl = (rawUrl: string): string => {
	try {
		return new URL(rawUrl).toString();
	} catch {
		return rawUrl;
	}
};

const normalizeReadableText = (value: string): string =>
	value.replace(/\s+/g, " ").trim();

const NON_READABLE_SELECTOR = "script, style, noscript, link, template";

const removeNonReadableNodes = (root: ParentNode): void => {
	root.querySelectorAll(NON_READABLE_SELECTOR).forEach((node) => {
		node.remove();
	});
};

const extractReadableHtmlText = (html: string): string =>
	html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

const hasReadableSessionContent = ({
	html,
	text,
}: Pick<WebSessionState, "html" | "text">): boolean =>
	Boolean(normalizeReadableText(text) || extractReadableHtmlText(html));

const isWideWebMode = (
	mode?: WebBrowserMode,
): mode is Exclude<WebBrowserMode, "iframe"> =>
	mode === "tab" || mode === "window";

const ensureBrowserEnvironment = (): void => {
	if (typeof window === "undefined" || typeof document === "undefined") {
		throw new Error("Web tools require DOM APIs from offscreen context.");
	}
};

const waitForFrameLoad = async (
	iframe: HTMLIFrameElement,
	timeoutMs: number,
): Promise<{ timedOut: boolean }> => {
	return new Promise<{ timedOut: boolean }>((resolve) => {
		const timeout = window.setTimeout(() => {
			resolve({ timedOut: true });
		}, timeoutMs);

		const onLoad = (): void => {
			window.clearTimeout(timeout);
			resolve({ timedOut: false });
		};
		const onError = (): void => {
			window.clearTimeout(timeout);
			resolve({ timedOut: true });
		};

		iframe.addEventListener("load", onLoad, { once: true });
		iframe.addEventListener("error", onError, { once: true });
	});
};

const safeDocument = (session: WebSessionState): Document | null => {
	if (session.mode !== "iframe" || !session.iframe) {
		return null;
	}
	try {
		return session.iframe.contentWindow?.document ?? null;
	} catch {
		return null;
	}
};

const safeCurrentUrl = (
	session: WebSessionState,
	requestedUrl: string,
): string => {
	if (session.mode !== "iframe" || !session.iframe) {
		return requestedUrl;
	}
	try {
		return session.iframe.contentWindow?.location?.href ?? requestedUrl;
	} catch {
		return requestedUrl;
	}
};

const safeTitle = (doc: Document | null): string => {
	if (!doc) {
		return "";
	}
	return doc.title || "";
};

const safeText = (doc: Document | null): string => {
	if (!doc) {
		return "";
	}
	const clonedDocument = doc.cloneNode(true) as Document;
	removeNonReadableNodes(clonedDocument);
	return (
		clonedDocument.body?.innerText ??
		clonedDocument.documentElement?.textContent ??
		""
	);
};

const safeHtml = (doc: Document | null): string => {
	if (!doc) {
		return "";
	}
	return doc.documentElement?.outerHTML ?? "";
};

const extractTextFromDocument = (doc: Document): string => {
	removeNonReadableNodes(doc);
	return doc.body?.innerText ?? doc.documentElement?.textContent ?? "";
};

const scheduleInactivityClose = (sessionId: string): void => {
	const existing = sessionTimeouts.get(sessionId);
	if (existing !== undefined) {
		window.clearTimeout(existing);
	}
	const timerId = window.setTimeout(() => {
		sessionTimeouts.delete(sessionId);
		void closeWebSession(sessionId);
	}, SESSION_TTL_MS);
	sessionTimeouts.set(sessionId, timerId);
};

const applySnapshotToSession = (
	session: WebSessionState,
	snapshot: WebSnapshotPayload,
): WebSessionState => {
	session.currentUrl = snapshot.url;
	session.title = snapshot.title;
	session.html = snapshot.html;
	session.text = snapshot.text;
	session.domAccessible = snapshot.domAccessible;
	session.lastAccessedAt = Date.now();
	return session;
};

const captureIframeSnapshot = (session: WebSessionState): WebSessionState => {
	const document = safeDocument(session);
	const html = safeHtml(document);
	session.currentUrl = safeCurrentUrl(session, session.requestedUrl);
	session.title = safeTitle(document);
	session.html = html;
	session.text = safeText(document);
	session.domAccessible = Boolean(document);
	session.lastAccessedAt = Date.now();
	return session;
};

const sendWebBrowserCommand = async (
	request: WebBrowserCommandRequest,
): Promise<SuccessfulWebBrowserCommandResponse> => {
	const rawResponse = await chrome.runtime.sendMessage(request);
	if (!isWebBrowserCommandResponse(rawResponse)) {
		throw new Error("Invalid response from browser web handler.");
	}
	if (!rawResponse.success) {
		throw new Error(rawResponse.error);
	}
	return rawResponse;
};

const captureBrowserSnapshot = async (
	session: WebSessionState,
	maxHtmlChars: number,
	timeoutMs: number,
): Promise<WebSessionState> => {
	if (typeof session.tabId !== "number") {
		throw new Error("Browser-backed web session is missing tabId.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "snapshot",
		sessionId: session.id,
		tabId: session.tabId,
		timeoutMs,
		maxHtmlChars,
	});
	if (response.command !== "snapshot") {
		throw new Error("Invalid browser snapshot response.");
	}

	return applySnapshotToSession(session, response.snapshot);
};

const disposeSessionArtifacts = async (
	session: WebSessionState,
): Promise<void> => {
	if (session.mode === "iframe") {
		session.iframe?.remove();
		return;
	}

	if (
		typeof session.tabId !== "number" &&
		typeof session.windowId !== "number"
	) {
		return;
	}

	await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "close",
		sessionId: session.id,
		tabId: session.tabId,
		windowId: session.windowId,
	}).catch(() => {});
};

const closeAllWebSessions = async (): Promise<void> => {
	for (const sessionId of Array.from(WEB_SESSIONS.keys())) {
		await closeWebSession(sessionId);
	}
};

export const disposeActiveWebSession = async (
	_reason?: string,
): Promise<void> => {
	for (const timerId of sessionTimeouts.values()) {
		window.clearTimeout(timerId);
	}
	sessionTimeouts.clear();
	await closeAllWebSessions();
	// Clear persisted session entries so stale tabs don't survive a full dispose.
	await savePersistedSessionEntries(new Map());
};

const touchSession = async (
	sessionId: string,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WebSessionState> => {
	const session =
		WEB_SESSIONS.get(sessionId) ?? (await recoverSession(sessionId));
	if (!session) {
		throw new Error(`No active web session: ${sessionId}`);
	}

	if (session.mode === "iframe") {
		captureIframeSnapshot(session);
	} else {
		try {
			await captureBrowserSnapshot(session, maxHtmlChars, timeoutMs);
		} catch {
			// Snapshot failed — the tab is likely mid-redirect (e.g. after a
			// Cloudflare challenge). Return the cached session content so the
			// caller can still read what was last captured. Mark domAccessible
			// false to signal that the content may be stale/partial.
			session.domAccessible = false;
		}
	}

	scheduleInactivityClose(sessionId);
	return session;
};

export const openWebSession = async ({
	url,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	persist = true,
	mode = "iframe",
}: OpenSessionArgs): Promise<OpenSessionResult> => {
	ensureBrowserEnvironment();
	if (!document.body && mode === "iframe") {
		throw new Error("Document body is not available for web sessions.");
	}

	const safeUrl = normalizeInputUrl(url);
	const id = crypto.randomUUID();
	const now = Date.now();

	if (isWideWebMode(mode)) {
		let response: SuccessfulWebBrowserCommandResponse;
		try {
			response = await sendWebBrowserCommand({
				source: WEB_BROWSER_COMMAND_SOURCE,
				command: "open",
				sessionId: id,
				url: safeUrl,
				mode,
				timeoutMs,
				maxHtmlChars,
			});
		} catch (openError) {
			// The tab may have been created but timed out before finishing load.
			// Parse the tab ID from the error message so we can still capture
			// whatever partial HTML loaded in the tab.
			const tabIdMatch =
				openError instanceof Error
					? openError.message.match(/browser tab (\d+)/)
					: null;
			if (!tabIdMatch) {
				throw openError;
			}
			const tabId = parseInt(tabIdMatch[1], 10);
			const session: WebSessionState = {
				id,
				requestedUrl: safeUrl,
				currentUrl: safeUrl,
				title: "",
				html: "",
				text: "",
				domAccessible: false,
				lastAccessedAt: now,
				createdAt: now,
				mode,
				tabId,
			};
			WEB_SESSIONS.set(id, session);
			persistSession(session);
			try {
				await captureBrowserSnapshot(session, maxHtmlChars, 5_000);
			} catch {
				// Snapshot failed — session keeps empty html, still usable
			}
			scheduleInactivityClose(id);
			return {
				session,
				disposable: !persist,
				renderReady: false,
			};
		}

		if (response.command !== "open") {
			throw new Error("Invalid browser open response.");
		}

		const session: WebSessionState = {
			id,
			requestedUrl: safeUrl,
			currentUrl: safeUrl,
			title: "",
			html: "",
			text: "",
			domAccessible: false,
			lastAccessedAt: now,
			createdAt: now,
			mode: response.surface.mode,
			tabId: response.surface.tabId,
			windowId: response.surface.windowId,
		};
		applySnapshotToSession(session, response.snapshot);
		WEB_SESSIONS.set(id, session);
		persistSession(session);
		let renderState: { matched: boolean; html: string; lastText: string };
		try {
			renderState = await waitForPageRender({
				session,
				timeoutMs,
				maxHtmlChars,
			});
		} catch {
			// waitForPageRender threw unexpectedly (should not happen after the
			// exception-safe loop fix, but kept as defence-in-depth). The session
			// is already stored — return it with renderReady:false so the caller
			// can still use the sessionId instead of orphaning it.
			scheduleInactivityClose(id);
			return {
				session,
				disposable: !persist,
				renderReady: false,
			};
		}
		scheduleInactivityClose(id);
		return {
			session,
			disposable: !persist,
			renderReady: renderState.matched,
		};
	}

	const iframe = buildIframe(safeUrl);
	document.body.appendChild(iframe);
	const { timedOut } = await waitForFrameLoad(iframe, timeoutMs);

	const session: WebSessionState = {
		id,
		requestedUrl: safeUrl,
		currentUrl: safeUrl,
		title: "",
		html: "",
		text: "",
		domAccessible: false,
		lastAccessedAt: now,
		createdAt: now,
		mode: "iframe",
		iframe,
	};
	captureIframeSnapshot(session);
	WEB_SESSIONS.set(id, session);

	if (timedOut) {
		scheduleInactivityClose(id);
		return {
			session,
			disposable: !persist,
			renderReady: false,
		};
	}

	let renderState: { matched: boolean; html: string; lastText: string };
	try {
		renderState = await waitForPageRender({
			session,
			timeoutMs,
			maxHtmlChars,
		});
	} catch {
		scheduleInactivityClose(id);
		return {
			session,
			disposable: !persist,
			renderReady: false,
		};
	}
	scheduleInactivityClose(id);
	return {
		session,
		disposable: !persist,
		renderReady: renderState.matched,
	};
};

export const refreshWebSession = async (
	sessionId: string,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WebSessionState> => {
	if (!WEB_SESSIONS.has(sessionId) && !(await recoverSession(sessionId))) {
		throw new Error(`No active web session: ${sessionId}`);
	}

	return touchSession(sessionId, maxHtmlChars, timeoutMs);
};

export const getWebSession = async (
	sessionId: string,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WebSessionState> =>
	refreshWebSession(sessionId, maxHtmlChars, timeoutMs);

export const fetchRenderedFallback = async ({
	url,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	maxHtmlChars: _maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
}: {
	url: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
}): Promise<
	Pick<WebSessionState, "title" | "html" | "text" | "currentUrl">
> => {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => {
		controller.abort();
	}, timeoutMs);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`Failed to fetch URL (status=${response.status})`);
		}
		const html = await response.text();
		const document = new DOMParser().parseFromString(html, "text/html");
		return {
			currentUrl: response.url,
			title: document.title || "",
			html,
			text: extractTextFromDocument(document),
		};
	} finally {
		window.clearTimeout(timeout);
	}
};

export const getOrOpenWebSession = async ({
	sessionId,
	url,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	browserMode = "iframe",
}: {
	sessionId?: string;
	url?: string;
	timeoutMs?: number;
	maxHtmlChars?: number;
	browserMode?: WebBrowserMode;
}): Promise<{ session: WebSessionState; disposable: boolean }> => {
	if (!sessionId && !url) {
		throw new Error("Either sessionId or url must be provided.");
	}

	if (sessionId) {
		return {
			session: await getWebSession(sessionId, maxHtmlChars, timeoutMs),
			disposable: false,
		};
	}

	const { session, disposable } = await openWebSession({
		url: url!,
		timeoutMs,
		maxHtmlChars,
		persist: false,
		mode: browserMode,
	});
	return { session, disposable };
};

export const closeWebSession = async (sessionId: string): Promise<void> => {
	const timerId = sessionTimeouts.get(sessionId);
	if (timerId !== undefined) {
		window.clearTimeout(timerId);
		sessionTimeouts.delete(sessionId);
	}

	const session = WEB_SESSIONS.get(sessionId);
	if (!session) {
		return;
	}

	unpersistSession(sessionId);
	await disposeSessionArtifacts(session);
	WEB_SESSIONS.delete(sessionId);
};

export const getActiveWebSessionInfo = (): ActiveWebSessionInfo => {
	let latest: WebSessionState | undefined;
	for (const session of WEB_SESSIONS.values()) {
		if (!latest || session.lastAccessedAt > latest.lastAccessedAt) {
			latest = session;
		}
	}
	if (!latest) {
		return { isOpen: false };
	}
	return {
		isOpen: true,
		sessionId: latest.id,
		requestedUrl: latest.requestedUrl,
		currentUrl: latest.currentUrl,
		title: latest.title,
		lastAccessedAt: latest.lastAccessedAt,
		createdAt: latest.createdAt,
		mode: latest.mode,
	};
};

export const getAllWebSessionsInfo = (): ActiveWebSessionInfo[] =>
	Array.from(WEB_SESSIONS.values()).map((session) => ({
		isOpen: true,
		sessionId: session.id,
		requestedUrl: session.requestedUrl,
		currentUrl: session.currentUrl,
		title: session.title,
		lastAccessedAt: session.lastAccessedAt,
		createdAt: session.createdAt,
		mode: session.mode,
	}));

export const closeAllWebSessionsExceptLatest = async (): Promise<void> => {
	if (WEB_SESSIONS.size <= 1) return;
	let latestId: string | undefined;
	let latestTime = 0;
	for (const [id, session] of WEB_SESSIONS) {
		if (session.lastAccessedAt > latestTime) {
			latestTime = session.lastAccessedAt;
			latestId = id;
		}
	}
	for (const sessionId of Array.from(WEB_SESSIONS.keys())) {
		if (sessionId !== latestId) {
			await closeWebSession(sessionId);
		}
	}
};

const elementInfo = (element: Element, index: number): WebDomElementInfo => ({
	index,
	tagName: element.tagName.toLowerCase(),
	id: element.getAttribute("id"),
	name: element.getAttribute("name"),
	type: element.getAttribute("type"),
	placeholder: element.getAttribute("placeholder"),
	ariaLabel:
		element.getAttribute("aria-label") ||
		element.getAttribute("aria-labelledby"),
	title: element.getAttribute("title"),
	role: element.getAttribute("role"),
	text: (element.textContent ?? "").trim(),
	value:
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
			? element.value
			: null,
	href:
		element instanceof HTMLAnchorElement ||
		element instanceof HTMLAreaElement ||
		element instanceof HTMLLinkElement
			? element.getAttribute("href")
			: null,
	disabled:
		(element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement ||
			element instanceof HTMLButtonElement) &&
		element.disabled,
	visible: isElementVisible(element),
	acceptsTextInput: acceptsTextInput(element),
});

const isElementVisible = (element: Element): boolean => {
	if (!(element instanceof HTMLElement)) {
		return true;
	}
	if (element.hidden) {
		return false;
	}
	const style = window.getComputedStyle(element);
	if (style.display === "none" || style.visibility === "hidden") {
		return false;
	}
	return Boolean(
		element.offsetWidth ||
			element.offsetHeight ||
			element.getClientRects().length,
	);
};

const acceptsTextInput = (element: Element): boolean => {
	if (element instanceof HTMLTextAreaElement) {
		return true;
	}
	if (!(element instanceof HTMLInputElement)) {
		return false;
	}
	const inputType = (element.type || "text").toLowerCase();
	return [
		"",
		"text",
		"search",
		"email",
		"url",
		"tel",
		"password",
		"number",
		"date",
		"datetime-local",
		"month",
		"time",
		"week",
	].includes(inputType);
};

const assertTextInputTarget = (element: Element): void => {
	if (element instanceof HTMLTextAreaElement) {
		return;
	}
	if (!(element instanceof HTMLInputElement)) {
		throw new Error("Target element does not support text input.");
	}
	const inputType = (element.type || "text").toLowerCase();
	if (!acceptsTextInput(element)) {
		throw new Error(
			`Target element is input[type=${inputType}] and does not support text input. Query again and choose a visible element with acceptsTextInput=true.`,
		);
	}
};

export const queryDomElements = async (
	session: WebSessionState,
	selector: string,
	maxResults: number,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WebDomElementInfo[]> => {
	if (session.mode === "iframe") {
		const document = safeDocument(session);
		if (!document) {
			throw new Error("DOM is not accessible for this session.");
		}

		const result: WebDomElementInfo[] = [];
		document.querySelectorAll(selector).forEach((node, index) => {
			if (result.length >= maxResults || !(node instanceof Element)) {
				return;
			}
			result.push(elementInfo(node, index));
		});
		return result;
	}

	if (typeof session.tabId !== "number") {
		throw new Error("Browser-backed web session is missing tabId.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "dom-query",
		sessionId: session.id,
		tabId: session.tabId,
		timeoutMs,
		maxHtmlChars,
		selector,
		maxResults,
	});
	if (response.command !== "dom-query") {
		throw new Error("Invalid browser DOM query response.");
	}

	applySnapshotToSession(session, response.snapshot);
	return response.elements;
};

const getIndexedElement = (
	session: WebSessionState,
	selector: string,
	index: number,
): Element => {
	const document = safeDocument(session);
	if (!document) {
		throw new Error("DOM is not accessible for this session.");
	}
	const nodeList = document.querySelectorAll(selector);
	const node = nodeList.item(index);
	if (!node) {
		throw new Error(`No element at index ${index} for selector: ${selector}`);
	}
	if (!(node instanceof Element)) {
		throw new Error("Matched node is not a valid Element.");
	}
	return node;
};

const buildSearchMatcher = (
	pattern: string,
	isRegex: boolean,
	caseSensitive: boolean,
): {
	patternText: string;
	matches(value: string): SearchPatternMatch | null;
} => {
	if (isRegex) {
		let matcher: RegExp;
		try {
			matcher = new RegExp(pattern, caseSensitive ? "" : "i");
		} catch (error) {
			throw new Error(
				error instanceof Error
					? error.message
					: "Invalid regular expression pattern",
			);
		}
		return {
			patternText: pattern,
			matches: (value) => {
				const match = matcher.exec(value);
				if (!match || match.index === undefined) {
					return null;
				}
				return {
					index: match.index,
				};
			},
		};
	}

	const needle = caseSensitive ? pattern : pattern.toLowerCase();
	return {
		patternText: pattern,
		matches: (value) => {
			const haystack = caseSensitive ? value : value.toLowerCase();
			const position = haystack.indexOf(needle);
			if (position < 0) {
				return null;
			}
			return { index: position };
		},
	};
};

export const searchInSessionHtml = async ({
	session,
	pattern,
	selector,
	isRegex = false,
	caseSensitive = false,
	maxMatches = 10,
	maxSnippetChars = 180,
}: {
	session: WebSessionState;
	pattern: string;
	selector?: string;
	isRegex?: boolean;
	caseSensitive?: boolean;
	maxMatches?: number;
	maxSnippetChars?: number;
}): Promise<SearchMatch[]> => {
	const doc =
		safeDocument(session) ??
		new DOMParser().parseFromString(session.html, "text/html");
	const matcher = buildSearchMatcher(pattern, isRegex, caseSensitive);
	const nodes: SearchMatch[] = [];

	const addMatch = (
		text: string,
		sourceTag: string,
		sourceIndex: number,
		match: SearchPatternMatch | null,
	): void => {
		const normalizedText = text.replace(/\s+/g, " ").trim();
		if (!normalizedText) {
			return;
		}
		const pos = match?.index ?? -1;
		if (pos < 0) {
			return;
		}
		const start = Math.max(0, pos - 80);
		const snippet = normalizedText.slice(start, start + maxSnippetChars);
		nodes.push({
			index: nodes.length,
			text: normalizedText,
			elementTag: sourceTag,
			elementIndex: sourceIndex,
			snippet,
		});
	};

	if (selector) {
		const elements = doc.querySelectorAll(selector);
		elements.forEach((element, elementIndex) => {
			if (nodes.length >= maxMatches || !(element instanceof Element)) {
				return;
			}

			const elementText = element.textContent ?? "";
			const match = matcher.matches(elementText);
			if (!match) {
				return;
			}
			addMatch(elementText, element.tagName.toLowerCase(), elementIndex, match);
		});
		return nodes;
	}

	const fullText = doc.documentElement?.textContent ?? "";
	const match = matcher.matches(fullText);
	if (match && fullText) {
		addMatch(fullText, "body", 0, match);
	}
	return nodes;
};

export const waitForDomSelector = async ({
	session,
	selector,
	state = "present",
	timeoutMs = DEFAULT_TIMEOUT_MS,
	intervalMs = DEFAULT_POLL_INTERVAL_MS,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
}: {
	session: WebSessionState;
	selector: string;
	state?: WebWaitSelectorState;
	timeoutMs?: number;
	intervalMs?: number;
	maxHtmlChars?: number;
}): Promise<{ matched: boolean; html: string; lastText: string }> => {
	if (session.mode === "iframe") {
		if (!safeDocument(session)) {
			throw new Error("DOM is not accessible for this session.");
		}

		const start = Date.now();
		const expectPresent = state === "present";
		while (true) {
			await refreshWebSession(session.id, maxHtmlChars, timeoutMs);
			const document = safeDocument(session);
			const matched = Boolean(document?.querySelector(selector));
			if ((expectPresent && matched) || (!expectPresent && !matched)) {
				return {
					matched: true,
					html: safeHtml(document),
					lastText: safeText(document),
				};
			}
			if (Date.now() - start >= timeoutMs) {
				return {
					matched: false,
					html: safeHtml(document),
					lastText: safeText(document),
				};
			}
			await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
		}
	}

	if (typeof session.tabId !== "number") {
		throw new Error("Browser-backed web session is missing tabId.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "wait-selector",
		sessionId: session.id,
		tabId: session.tabId,
		timeoutMs,
		intervalMs,
		maxHtmlChars,
		selector,
		state,
	});
	if (response.command !== "wait-selector") {
		throw new Error("Invalid browser wait response.");
	}

	applySnapshotToSession(session, response.snapshot);
	return {
		matched: response.matched,
		html: session.html,
		lastText: session.text,
	};
};

export const waitForPageRender = async ({
	session,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	intervalMs = DEFAULT_POLL_INTERVAL_MS,
	stabilityMs = 1_000,
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
}: {
	session: WebSessionState;
	timeoutMs?: number;
	intervalMs?: number;
	stabilityMs?: number;
	maxHtmlChars?: number;
}): Promise<{ matched: boolean; html: string; lastText: string }> => {
	if (session.mode === "iframe" && !safeDocument(session)) {
		throw new Error("Current iframe session cannot observe page render state.");
	}

	const startedAt = Date.now();
	let stableSince: number | null = null;
	let previousSnapshot:
		| {
				currentUrl: string;
				title: string;
				html: string;
				text: string;
		  }
		| undefined;

	while (true) {
		try {
			await refreshWebSession(session.id, maxHtmlChars, timeoutMs);
		} catch {
			// Snapshot failed — the tab is likely navigating due to a redirect
			// (e.g. Cloudflare challenge → real page). Treat this as "not stable
			// yet": reset the stability clock and keep polling until timeout.
			previousSnapshot = undefined;
			stableSince = null;
			const now = Date.now();
			if (now - startedAt >= timeoutMs) {
				return {
					matched: false,
					html: session.html,
					lastText: session.text,
				};
			}
			await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
			continue;
		}

		const currentSnapshot = {
			currentUrl: session.currentUrl,
			title: session.title,
			html: session.html,
			text: session.text,
		};

		const isStable =
			previousSnapshot?.currentUrl === currentSnapshot.currentUrl &&
			previousSnapshot?.title === currentSnapshot.title &&
			previousSnapshot?.html === currentSnapshot.html &&
			previousSnapshot?.text === currentSnapshot.text;
		const hasReadableContent = hasReadableSessionContent(currentSnapshot);

		const now = Date.now();
		if (isStable && hasReadableContent) {
			stableSince ??= now;
			if (now - stableSince >= stabilityMs) {
				return {
					matched: true,
					html: session.html,
					lastText: session.text,
				};
			}
		} else {
			previousSnapshot = currentSnapshot;
			stableSince = null;
		}

		if (now - startedAt >= timeoutMs) {
			return {
				matched: false,
				html: session.html,
				lastText: session.text,
			};
		}

		await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
	}
};

export const performDomAction = async (
	session: WebSessionState,
	action: WebDomActionName,
	options: {
		selector: string;
		index?: number;
		value?: string;
	},
	maxHtmlChars = DEFAULT_MAX_HTML_CHARS,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<WebElementRecord> => {
	const index = options.index ?? 0;

	if (session.mode === "iframe") {
		const document = safeDocument(session);
		if (!document) {
			throw new Error("DOM is not accessible for this session.");
		}

		const element = getIndexedElement(session, options.selector, index);
		if (action === "focus") {
			(element as HTMLElement).focus();
			return {
				label: element.tagName.toLowerCase(),
				text: element.textContent ?? "",
				value:
					(
						element as
							| HTMLInputElement
							| HTMLTextAreaElement
							| HTMLSelectElement
					).value ?? null,
			};
		}
		if (action === "scrollBottom") {
			session.iframe?.contentWindow?.scrollTo({
				top: document.body?.scrollHeight ?? 0,
				left: 0,
				behavior: "smooth",
			});
			return {
				label: element.tagName.toLowerCase(),
				text: element.textContent ?? "",
				value:
					(
						element as
							| HTMLInputElement
							| HTMLTextAreaElement
							| HTMLSelectElement
					).value ?? null,
			};
		}
		if (action === "scrollTop") {
			session.iframe?.contentWindow?.scrollTo({
				top: 0,
				left: 0,
				behavior: "smooth",
			});
			return {
				label: element.tagName.toLowerCase(),
				text: element.textContent ?? "",
				value:
					(
						element as
							| HTMLInputElement
							| HTMLTextAreaElement
							| HTMLSelectElement
					).value ?? null,
			};
		}
		if (action === "read") {
			return {
				label: element.tagName.toLowerCase(),
				text: element.textContent ?? "",
				value:
					"value" in element && typeof element.value === "string"
						? element.value
						: null,
			};
		}
		if (
			action === "click" &&
			"click" in element &&
			typeof element.click === "function"
		) {
			element.click();
			return {
				label: element.tagName.toLowerCase(),
				text: element.textContent ?? "",
				value:
					(
						element as
							| HTMLInputElement
							| HTMLTextAreaElement
							| HTMLSelectElement
					).value ?? null,
			};
		}
		if (
			action === "input" &&
			"focus" in element &&
			typeof element.focus === "function"
		) {
			assertTextInputTarget(element);
			const inputValue = options.value ?? "";
			element?.focus();
			if (
				element instanceof HTMLInputElement ||
				element instanceof HTMLTextAreaElement
			) {
				element.value = inputValue;
				element.dispatchEvent(new Event("input", { bubbles: true }));
				element.dispatchEvent(new Event("change", { bubbles: true }));
			}
			return {
				label: element.tagName.toLowerCase(),
				text:
					element instanceof HTMLInputElement ||
					element instanceof HTMLTextAreaElement
						? element.value
						: "",
				value: inputValue,
			};
		}

		throw new Error(`Unsupported dom action: ${action}`);
	}

	if (typeof session.tabId !== "number") {
		throw new Error("Browser-backed web session is missing tabId.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "dom-action",
		sessionId: session.id,
		tabId: session.tabId,
		timeoutMs,
		maxHtmlChars,
		action,
		selector: options.selector,
		index,
		value: options.value,
	});
	if (response.command !== "dom-action") {
		throw new Error("Invalid browser DOM action response.");
	}

	applySnapshotToSession(session, response.snapshot);
	return response.result;
};

export const captureWebSessionScreenshot = async (
	sessionId: string,
): Promise<{ dataUrl: string; width: number; height: number }> => {
	const session =
		WEB_SESSIONS.get(sessionId) ?? (await recoverSession(sessionId));
	if (!session) {
		throw new Error(`No active web session: ${sessionId}`);
	}

	if (session.mode === "iframe") {
		if (!session.iframe) {
			throw new Error("Iframe element is not available for screenshot.");
		}
		const { default: html2canvas } = await import("html2canvas");
		const target =
			session.iframe.contentDocument?.body ?? (session.iframe as HTMLElement);
		const canvas = await html2canvas(target, {
			useCORS: true,
			allowTaint: true,
			logging: false,
		});
		return {
			dataUrl: canvas.toDataURL("image/png"),
			width: canvas.width,
			height: canvas.height,
		};
	}

	if (typeof session.tabId !== "number") {
		throw new Error("Web session has no associated browser tab.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "screenshot",
		sessionId,
		tabId: session.tabId,
		windowId: session.windowId,
	});

	if (response.command !== "screenshot") {
		throw new Error("Invalid screenshot response from background.");
	}

	return {
		dataUrl: response.dataUrl,
		width: response.width,
		height: response.height,
	};
};

export const fetchImageFromSession = async (
	sessionId: string,
	url: string,
): Promise<{ base64: string; mimeType: string }> => {
	const session =
		WEB_SESSIONS.get(sessionId) ?? (await recoverSession(sessionId));
	if (!session) {
		throw new Error(`No active web session: ${sessionId}`);
	}

	if (session.mode === "iframe") {
		throw new Error(
			"Fetching images via iframe sessions is not supported. Open a tab or window session instead.",
		);
	}

	if (typeof session.tabId !== "number") {
		throw new Error("Web session has no associated browser tab.");
	}

	const response = await sendWebBrowserCommand({
		source: WEB_BROWSER_COMMAND_SOURCE,
		command: "fetch-image",
		sessionId,
		url,
		tabId: session.tabId,
	});

	if (response.command !== "fetch-image") {
		throw new Error("Invalid fetch-image response from background.");
	}

	return { base64: response.base64, mimeType: response.mimeType };
};

export const getLatestTabSession = ():
	| { sessionId: string; tabId: number }
	| undefined => {
	let latest: WebSessionState | undefined;
	for (const session of WEB_SESSIONS.values()) {
		if (
			typeof session.tabId === "number" &&
			session.mode !== "iframe" &&
			(!latest || session.lastAccessedAt > latest.lastAccessedAt)
		) {
			latest = session;
		}
	}
	if (!latest || typeof latest.tabId !== "number") return undefined;
	return { sessionId: latest.id, tabId: latest.tabId };
};

export const createDefaultWebErrorResult = (error: unknown): string => {
	return JSON.stringify(
		{
			actionType: "web_tool_error",
			success: false,
			error: error instanceof Error ? error.message : String(error),
		},
		null,
		2,
	);
};

export const createWebResult = (payload: Record<string, unknown>): string =>
	JSON.stringify(payload, null, 2);
