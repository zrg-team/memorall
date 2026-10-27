import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	webUrl,
	optionalToolChoice,
	optionalToolInteger,
	optionalToolBoolean,
} from "./web-input.js";
import {
	MAX_WEB_MAX_HTML_CHARS,
	MIN_WEB_MAX_HTML_CHARS,
	normalizeWebMaxHtmlChars,
} from "./max-html-chars.js";
import {
	isFileSession,
	looksLikeFileUrl,
	saveFileAt,
	saveSessionFile,
	type WebResourceServices,
	type WebSavedFile,
	webFileFields,
} from "./web-resource.js";
import {
	createCleanHtml,
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	resolveWebBlock,
	truncateContent,
	webBlockFields,
} from "./web-tool-utils.js";

const TOOL_NAME = "web_open" as const;

const schema = z.object({
	url: webUrl().describe("Target web URL to open."),
	browserMode: optionalToolChoice(["iframe", "tab", "window"]).describe(
		"Open mode. Leave it out for a browser window (falls back to a tab); `tab` for a tab; `iframe` only for a local server (localhost or a sandbox preview), and on a public site it opens a window instead.",
	),
	timeoutMs: optionalToolInteger().describe(
		"Navigation wait timeout in milliseconds.",
	),
	maxHtmlChars: optionalToolInteger().describe(
		`Limit HTML length returned to the agent. Values are clamped to ${MIN_WEB_MAX_HTML_CHARS}-${MAX_WEB_MAX_HTML_CHARS}.`,
	),
	keepSession: optionalToolBoolean().describe(
		"Keep session alive for follow-up DOM actions (default true).",
	),
});

type Input = z.infer<typeof schema>;

export const createWebOpenTool: ToolFactory<Input, WebResourceServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Open a web URL in a browser window (or `tab`; `iframe` only for a local server), wait for the initial navigation load, and expose `sessionId` for follow-up actions. When `renderReady` is false the page timed out but partial content is included — inspect `partialContent` to decide whether to call `web_wait` then `web_read`, or skip this page. " +
		"If `file` is present the URL is a file (PDF, image, video, archive), not a page: it was saved to `file.path`, and `text` holds its readable text when it has any. " +
		"If `blocked` is present the page is a bot wall (CAPTCHA, Cloudflare, rate limit or login gate), not the content: stop, tell the user what is blocking, and do not retry the same URL — the user has a button to solve it themselves.",
	schema,
	execute: async (input, context) => {
		const webBrowser = requireWebBrowserService(services);
		const maxHtmlChars = normalizeWebMaxHtmlChars(input.maxHtmlChars);
		const timeoutMs = Math.max(500, input.timeoutMs ?? 15_000);
		let disposableSessionId: string | undefined;
		const fileResult = (file: WebSavedFile) =>
			createWebResult({
				actionType: "web_open",
				success: true,
				requestedUrl: input.url,
				url: file.url,
				renderReady: true,
				...webFileFields(file, maxHtmlChars),
			});
		try {
			// An address that names a file needs no tab, and a tab would cost more
			// than a wait: the browser saves anything it cannot show into the user's
			// own Downloads folder. A login page served in its place is a page, so
			// that still opens below.
			if (looksLikeFileUrl(input.url)) {
				const file = await saveFileAt(services, input.url);
				if (file) return fileResult(file);
			}

			let openedResult: Awaited<ReturnType<typeof webBrowser.openSession>>;
			try {
				openedResult = await webBrowser.openSession({
					url: input.url,
					timeoutMs,
					maxHtmlChars,
					persist: input.keepSession ?? true,
					mode: input.browserMode,
				});
			} catch (openError) {
				// A navigation that becomes a download closes its tab, which reads as
				// a failed open. The address was a file all along.
				const file = await saveFileAt(services, input.url);
				if (file) return fileResult(file);
				throw openError;
			}
			const { session: opened, disposable, renderReady } = openedResult;
			if (disposable) {
				disposableSessionId = opened.id;
			}

			// A PDF or an image shows in the browser's own viewer, whose DOM is an
			// empty shell: fetch the file from inside the tab instead, where the
			// site's cookies still apply.
			if (isFileSession(opened)) {
				const pageFields = {
					sessionId: opened.id,
					requestedUrl: input.url,
					url: opened.currentUrl,
					title: opened.title,
					domAccessible: opened.domAccessible,
					browserMode: opened.mode,
					renderReady: true,
					contentType: opened.contentType,
				};
				try {
					const file = await saveSessionFile(services, opened);
					return createWebResult({
						actionType: "web_open",
						success: true,
						...pageFields,
						...webFileFields(file, maxHtmlChars),
					});
				} catch (error) {
					return createWebResult({
						actionType: "web_open",
						success: true,
						...pageFields,
						text: null,
						fileError: error instanceof Error ? error.message : String(error),
						hint: `This address is a file (${opened.contentType}), not a web page, and it could not be downloaded. Try web_download with this sessionId.`,
					});
				}
			}

			// Park here if the page is a bot wall, so the user can clear it and the
			// same call carries on against the same tab. Keep a disposable session
			// alive for that: closing it would take away the very page the handoff
			// button is about to raise.
			const session = await resolveWebBlock(services, opened, {
				tool: TOOL_NAME,
				toolCallId: context?.toolCallId,
			});
			if (session.block) {
				disposableSessionId = undefined;
			}

			if (!renderReady) {
				const cleanHtml = truncateContent(
					createCleanHtml(session.html),
					maxHtmlChars,
				);
				return createWebResult({
					actionType: "web_open",
					success: true,
					sessionId: session.id,
					requestedUrl: input.url,
					url: session.currentUrl,
					title: session.title,
					domAccessible: session.domAccessible,
					browserMode: session.mode,
					renderReady: false,
					...webBlockFields(session),
					partialContent: cleanHtml || null,
					text: truncateContent(session.text, maxHtmlChars) || null,
					hint: 'Page load timed out. partialContent shows what loaded so far. Call web_wait (waitMode="render") then web_read to get more content, or skip this page if partialContent is empty.',
				});
			}

			return createWebResult({
				actionType: "web_open",
				success: true,
				sessionId: session.id,
				requestedUrl: input.url,
				url: session.currentUrl,
				title: session.title,
				domAccessible: session.domAccessible,
				browserMode: session.mode,
				renderReady: true,
				...webBlockFields(session),
				text: truncateContent(session.text, maxHtmlChars),
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		} finally {
			if (disposableSessionId) {
				await webBrowser.closeSession(disposableSessionId);
			}
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebOpenTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebResourceServices;
		};
	}
}
