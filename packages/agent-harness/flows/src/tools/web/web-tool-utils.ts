import sanitizeHtml from "sanitize-html";
import type {} from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import type {
	IFlowWebBrowserService,
	WebSession,
} from "../../interfaces/services/web-browser.js";
import { describeWebBlock } from "./challenge-detection.js";

export type WebToolServices = Pick<AllServices, "webBrowser">;

export const requireWebBrowserService = (
	services: WebToolServices,
): IFlowWebBrowserService => {
	if (!services.webBrowser) {
		throw new Error("Web browser service is not available.");
	}
	return services.webBrowser;
};

export const createDefaultWebErrorResult = (error: unknown): string =>
	JSON.stringify(
		{
			actionType: "web_tool_error",
			success: false,
			error: error instanceof Error ? error.message : String(error),
		},
		null,
		2,
	);

export const createWebResult = (payload: Record<string, unknown>): string =>
	JSON.stringify(payload, null, 2);

/**
 * Result fields describing a bot wall, spread into a tool payload.
 *
 * Empty when the page is fine, so callers can spread it unconditionally. When
 * the page is a wall this carries the kind, the marker that matched, a sentence
 * the UI can show, and the transport handle the handoff button needs to give the
 * page back to the user.
 */
export const webBlockFields = (
	session: Pick<WebSession, "block" | "tabId">,
): Record<string, unknown> => {
	if (!session.block) return {};
	return {
		blocked: {
			kind: session.block.kind,
			marker: session.block.marker,
			description: describeWebBlock(session.block),
		},
		...(typeof session.tabId === "number" ? { tabId: session.tabId } : {}),
	};
};

const NON_READABLE_ELEMENT_PATTERN =
	/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi;

export const stripNonReadableHtml = (html: string): string =>
	html
		.replace(NON_READABLE_ELEMENT_PATTERN, " ")
		.replace(/<link\b[^>]*>/gi, " ")
		.replace(/<meta\b[^>]*>/gi, " ");

export const createCleanHtml = (
	html: string,
	allowedAttributes?: Record<string, sanitizeHtml.AllowedAttribute[]>,
): string =>
	sanitizeHtml(stripNonReadableHtml(html), {
		allowedTags: false,
		allowedAttributes: allowedAttributes ?? {
			a: ["href"],
			img: ["src", "alt"],
		},
		disallowedTagsMode: "discard",
		exclusiveFilter: (frame) =>
			frame.tag === "script" ||
			frame.tag === "style" ||
			frame.tag === "noscript" ||
			frame.tag === "link",
	});

export const createCleanHtmlWithSelectors = (html: string): string =>
	createCleanHtml(html, {
		"*": ["id", "class", "data-selector", "aria-label", "placeholder", "href"],
	});

export const truncateContent = (value: string, maxChars: number): string => {
	if (value.length <= maxChars) {
		return value;
	}
	return `${value.slice(0, maxChars)}\n...truncated`;
};
