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

/**
 * How many times a wall may be re-checked before the tool gives up.
 *
 * A user who cannot clear it in three tries is not going to, and each round
 * costs another full wait.
 */
const MAX_CHALLENGE_ROUNDS = 3;

/**
 * Park the tool while the user clears a bot wall, then re-check the page.
 *
 * The retry is a session refresh rather than a fresh call of the tool, because
 * the user solves the challenge in the session's own tab: once solved, that tab
 * holds the real content, and every snapshot recomputes the block signal from
 * scratch, so a cleared wall clears itself. Re-running the tool would instead
 * open a second tab and orphan the one the user just solved.
 *
 * Returns the session unchanged whenever the handoff cannot help, so the caller
 * always ends up with something to report:
 *
 * - the page is not a wall,
 * - the backend has no way to ask (a content script, or a harness backend
 *   without the capability),
 * - the session is an offscreen iframe, which has no window of its own to raise,
 *   so the button would be offered and then fail,
 * - or the user skipped, cancelled, or ran out of time.
 */
export const resolveWebBlock = async (
	services: WebToolServices,
	session: WebSession,
	context: { tool: string; toolCallId?: string },
): Promise<WebSession> => {
	const webBrowser = services.webBrowser;
	if (!webBrowser?.awaitChallengeResolution) return session;

	let current = session;
	for (let round = 0; round < MAX_CHALLENGE_ROUNDS; round += 1) {
		if (!current.block) return current;
		if (current.mode === "iframe") return current;

		const resolution = await webBrowser.awaitChallengeResolution({
			sessionId: current.id,
			tool: context.tool,
			toolCallId: context.toolCallId,
		});
		if (resolution.outcome !== "retry") return current;

		try {
			current = await webBrowser.refreshSession({
				sessionId: resolution.sessionId ?? current.id,
			});
		} catch {
			// The tab went away while the user was working on it. Report the wall we
			// already know about rather than failing the whole tool call.
			return current;
		}
	}

	return current;
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
