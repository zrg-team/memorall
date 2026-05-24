import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import type { WebSession } from "../../interfaces/web-browser";
import {
	MAX_WEB_MAX_HTML_CHARS,
	MIN_WEB_MAX_HTML_CHARS,
	normalizeWebMaxHtmlChars,
} from "../../utils/max-html-chars";
import {
	createCleanHtml,
	createDefaultWebErrorResult,
	createWebResult,
	stripNonReadableHtml,
	truncateContent,
	requireWebBrowserService,
	type WebToolServices,
} from "./web-tool-utils";

const TOOL_NAME = "web_read" as const;
const SMART_READ_MAX_RETRIES = 2;
const SMART_READ_RETRY_DELAY_MS = 750;
const SMART_READ_MAX_TIMEOUT_MS = 5_000;
const SMART_READ_MIN_USEFUL_TEXT_CHARS = 80;
const SMART_READ_SHORT_TEXT_CHARS = 40;
const CONTENT_MODE_VALUES = [
	"text",
	"structure_text",
	"html",
	"clean_html",
] as const;
type ContentMode = (typeof CONTENT_MODE_VALUES)[number];
type NormalizedContentMode = "text" | "html" | "clean_html";
type SmartRetryReason =
	| "empty_content"
	| "short_app_shell_content"
	| "selector_no_matches"
	| "selector_empty_content";

interface ReadSnapshot {
	session: WebSession;
	contentMode: NormalizedContentMode;
	content: string;
	readableText: string;
	selector?: string;
	matchCount?: number;
}

interface SmartRetryMetadata {
	smartRetry?: true;
	smartRetryAttempts?: number;
	smartRetryReason?: SmartRetryReason;
	smartRetryExhausted?: boolean;
}

const schema = z.object({
	sessionId: z.string().optional().describe("Active web session to read."),
	url: z
		.string()
		.url()
		.optional()
		.describe("Open first, then read. Use with no sessionId."),
	browserMode: z
		.enum(["iframe", "tab", "window"])
		.optional()
		.describe("Open mode when no sessionId is provided."),
	maxHtmlChars: z
		.number()
		.int()
		.optional()
		.describe(
			`Limit HTML length returned to the agent. Values are clamped to ${MIN_WEB_MAX_HTML_CHARS}-${MAX_WEB_MAX_HTML_CHARS}.`,
		),
	timeoutMs: z
		.number()
		.int()
		.optional()
		.describe("Navigation/load timeout used when opening by URL."),
	selector: z
		.string()
		.optional()
		.describe("Optional selector for a focused read."),
	contentMode: z
		.enum(CONTENT_MODE_VALUES)
		.optional()
		.describe(
			"Content format. Default is `text`. `text` returns readable page text, `html` returns rendered HTML, `clean_html` returns HTML with tags only and no attributes/scripts/styles.",
		),
});

type Input = z.infer<typeof schema>;

const parseHtml = (html: string): Document =>
	new DOMParser().parseFromString(
		html || "<html><body></body></html>",
		"text/html",
	);

const NON_READABLE_SELECTOR = "script, style, noscript, link, template";

const removeNonReadableNodes = (document: Document): void => {
	document.querySelectorAll(NON_READABLE_SELECTOR).forEach((node) => {
		node.remove();
	});
};

const normalizeContentMode = (
	contentMode: ContentMode,
): NormalizedContentMode =>
	contentMode === "structure_text" ? "text" : contentMode;

const waitFixedDelay = async (delayMs: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, delayMs));

const normalizeWhitespace = (value: string): string =>
	value.replace(/\s+/g, " ").trim();

const extractSelectorHtml = (
	html: string,
	selector: string,
	maxMatches = 10,
): { html: string; matchCount: number } => {
	const document = parseHtml(html);
	const matchedElements = Array.from(document.querySelectorAll(selector)).slice(
		0,
		maxMatches,
	);
	return {
		html: matchedElements.map((element) => element.outerHTML).join("\n"),
		matchCount: matchedElements.length,
	};
};

const extractTextFromHtml = (html: string): string => {
	const document = parseHtml(stripNonReadableHtml(html));
	removeNonReadableNodes(document);
	return (
		document.body?.innerText ??
		document.body?.textContent ??
		document.documentElement?.textContent ??
		""
	).trim();
};

const hasAppShellMarkers = (html: string): boolean => {
	if (!html.trim()) {
		return false;
	}
	const document = parseHtml(html);
	const scriptCount = document.querySelectorAll("script").length;
	const hasRootContainer = Boolean(
		document.querySelector(
			"#root, #app, #__next, #__nuxt, [data-reactroot], [data-nextjs-root]",
		),
	);
	const hasBundledScript = Array.from(document.querySelectorAll("script")).some(
		(script) => {
			const src = script.getAttribute("src") ?? "";
			return /\/(assets|static|chunks?)\/|bundle|webpack|vite|next/i.test(src);
		},
	);
	return hasRootContainer || hasBundledScript || scriptCount >= 3;
};

const detectSmartRetryReason = (
	snapshot: ReadSnapshot,
): SmartRetryReason | null => {
	const readableText = normalizeWhitespace(snapshot.readableText);
	const content = normalizeWhitespace(snapshot.content);
	const hasHtml = Boolean(snapshot.session.html.trim());

	if (snapshot.selector && snapshot.matchCount === 0) {
		return "selector_no_matches";
	}
	if (snapshot.selector && !content) {
		return "selector_empty_content";
	}
	if (!content && !readableText) {
		return "empty_content";
	}
	if (
		hasHtml &&
		readableText.length < SMART_READ_SHORT_TEXT_CHARS &&
		hasAppShellMarkers(snapshot.session.html)
	) {
		return "short_app_shell_content";
	}
	if (
		hasHtml &&
		readableText.length < SMART_READ_MIN_USEFUL_TEXT_CHARS &&
		hasAppShellMarkers(snapshot.session.html) &&
		/^(loading|please wait|enable javascript|just a moment)\.?\s*$/i.test(
			readableText,
		)
	) {
		return "short_app_shell_content";
	}
	return null;
};

const buildReadContent = ({
	rawHtml,
	rawText,
	contentMode,
	maxChars,
}: {
	rawHtml: string;
	rawText: string;
	contentMode: ContentMode;
	maxChars: number;
}): {
	contentMode: NormalizedContentMode;
	content: string;
} => {
	const normalizedMode = normalizeContentMode(contentMode);

	if (normalizedMode === "text") {
		const readableText = rawHtml ? extractTextFromHtml(rawHtml) : rawText;
		return {
			contentMode: normalizedMode,
			content: truncateContent(readableText, maxChars),
		};
	}

	if (normalizedMode === "clean_html") {
		const cleanHtml = createCleanHtml(rawHtml);
		return {
			contentMode: normalizedMode,
			content: truncateContent(cleanHtml, maxChars),
		};
	}

	return {
		contentMode: normalizedMode,
		content: truncateContent(rawHtml, maxChars),
	};
};

const buildSelectorReadSnapshot = (
	session: WebSession,
	selector: string,
	contentMode: ContentMode,
	maxChars: number,
): ReadSnapshot => {
	const selectorHtml = extractSelectorHtml(session.html, selector, 10);
	const readableText = extractTextFromHtml(selectorHtml.html);
	const transformedContent = buildReadContent({
		rawHtml: selectorHtml.html,
		rawText: readableText,
		contentMode,
		maxChars,
	});
	return {
		session,
		selector,
		matchCount: selectorHtml.matchCount,
		contentMode: transformedContent.contentMode,
		content: transformedContent.content,
		readableText,
	};
};

const buildSessionReadSnapshot = (
	session: WebSession,
	contentMode: ContentMode,
	maxChars: number,
): ReadSnapshot => {
	const readableText = session.html
		? extractTextFromHtml(session.html)
		: session.text;
	const transformedContent = buildReadContent({
		rawHtml: session.html,
		rawText: session.text,
		contentMode,
		maxChars,
	});
	return {
		session,
		contentMode: transformedContent.contentMode,
		content: transformedContent.content,
		readableText,
	};
};

const createReadResult = (
	snapshot: ReadSnapshot,
	metadata: SmartRetryMetadata = {},
): ReturnType<typeof createWebResult> => {
	return createWebResult({
		actionType: "web_read",
		success: true,
		sessionId: snapshot.session.id,
		url: snapshot.session.currentUrl,
		title: snapshot.session.title,
		domAccessible: snapshot.session.domAccessible,
		browserMode: snapshot.session.mode,
		selector: snapshot.selector,
		matchCount: snapshot.matchCount,
		contentMode: snapshot.contentMode,
		content: snapshot.content,
		...metadata,
	});
};

const buildReadSnapshot = (
	session: WebSession,
	contentMode: ContentMode,
	maxChars: number,
	selector?: string,
): ReadSnapshot =>
	selector
		? buildSelectorReadSnapshot(session, selector, contentMode, maxChars)
		: buildSessionReadSnapshot(session, contentMode, maxChars);

const readWithSmartRetry = async ({
	webBrowser,
	session,
	contentMode,
	maxChars,
	timeoutMs,
	selector,
}: {
	webBrowser: ReturnType<typeof requireWebBrowserService>;
	session: WebSession;
	contentMode: ContentMode;
	maxChars: number;
	timeoutMs: number;
	selector?: string;
}): Promise<ReturnType<typeof createWebResult>> => {
	let latestSession = session;
	let snapshot = buildReadSnapshot(
		latestSession,
		contentMode,
		maxChars,
		selector,
	);
	const initialRetryReason = detectSmartRetryReason(snapshot);
	if (!initialRetryReason) {
		return createReadResult(snapshot);
	}

	const startedAt = Date.now();
	let attempts = 0;
	let exhausted = true;
	while (
		attempts < SMART_READ_MAX_RETRIES &&
		Date.now() - startedAt < SMART_READ_MAX_TIMEOUT_MS
	) {
		attempts += 1;
		await waitFixedDelay(SMART_READ_RETRY_DELAY_MS);
		const remainingTimeoutMs = Math.max(
			500,
			Math.min(timeoutMs, SMART_READ_MAX_TIMEOUT_MS - (Date.now() - startedAt)),
		);

		try {
			const renderResult = await webBrowser.waitForPageRender({
				sessionId: latestSession.id,
				timeoutMs: remainingTimeoutMs,
				intervalMs: Math.min(250, SMART_READ_RETRY_DELAY_MS),
				stabilityMs: Math.min(1_000, remainingTimeoutMs),
				maxHtmlChars: maxChars,
			});
			latestSession = await webBrowser.refreshSession({
				sessionId: latestSession.id,
				maxHtmlChars: maxChars,
				timeoutMs: remainingTimeoutMs,
			});
			if (!latestSession.html && renderResult.html) {
				latestSession = {
					...latestSession,
					html: renderResult.html,
					text: renderResult.lastText,
				};
			}
		} catch {
			break;
		}

		snapshot = buildReadSnapshot(
			latestSession,
			contentMode,
			maxChars,
			selector,
		);
		if (!detectSmartRetryReason(snapshot)) {
			exhausted = false;
			break;
		}
	}

	return createReadResult(snapshot, {
		smartRetry: true,
		smartRetryAttempts: attempts,
		smartRetryReason: initialRetryReason,
		smartRetryExhausted: exhausted,
	});
};

export const createWebReadTool: ToolFactory<Input, WebToolServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read rendered page content from an active web session or directly from a URL. Default output is readable text.",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		let disposableSession = false;
		let sessionId = input.sessionId;
		const contentMode = input.contentMode ?? "text";
		const maxChars = normalizeWebMaxHtmlChars(input.maxHtmlChars);
		const timeoutMs = Math.max(500, input.timeoutMs ?? 15_000);
		try {
			const sessionResult = await webBrowser.getOrOpenSession({
				sessionId: input.sessionId,
				url: input.url,
				timeoutMs,
				maxHtmlChars: maxChars,
				browserMode: input.browserMode,
			});
			disposableSession = sessionResult.disposable;
			sessionId = sessionResult.session.id;
			const session = sessionResult.session;

			if (session.mode === "iframe" && !session.domAccessible) {
				const fallback = await webBrowser.fetchRenderedFallback({
					url: session.requestedUrl,
					timeoutMs,
					maxHtmlChars: maxChars,
				});
				const transformedFallback = buildReadContent({
					rawHtml: fallback.html,
					rawText: fallback.text,
					contentMode,
					maxChars,
				});
				return createWebResult({
					actionType: "web_read",
					success: true,
					sessionId: session.id,
					url: fallback.currentUrl,
					title: fallback.title,
					domAccessible: false,
					browserMode: session.mode,
					contentMode: transformedFallback.contentMode,
					content: transformedFallback.content,
					fallback: "network",
				});
			}

			return readWithSmartRetry({
				webBrowser,
				session,
				contentMode,
				maxChars,
				timeoutMs,
				selector: input.selector,
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		} finally {
			if (disposableSession && sessionId) {
				await webBrowser.closeSession(sessionId);
			}
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebToolServices;
		};
	}
}
