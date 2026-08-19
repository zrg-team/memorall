/**
 * @vitest-environment jsdom
 *
 * `web_read` parses HTML with DOMParser, so these need a DOM.
 */
import { describe, expect, it } from "vitest";
import { createWebOpenTool } from "../tools/web/web-open.js";
import { createWebReadTool } from "../tools/web/web-read.js";
import type { WebSession } from "../interfaces/services/web-browser.js";
import type { WebToolServices } from "../tools/web/web-tool-utils.js";
import { setHtmlParser } from "../utils/html-parser.js";

// The harness never assumes a DOM; the host injects the parser.
setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));

/**
 * A bot wall is dangerous because it looks like a success: the page has readable
 * text, so it settles and reports `success`/`renderReady`/`domAccessible`. These
 * tests pin that the wall now reaches the tool payload, which is what the UI card
 * and the model both key off.
 */

const session = (overrides: Partial<WebSession> = {}): WebSession => ({
	id: "session-1",
	requestedUrl: "https://example.test/article",
	currentUrl: "https://example.test/article",
	title: "Just a moment...",
	html: "<title>Just a moment...</title>",
	text: "Checking your browser before accessing example.test",
	domAccessible: true,
	lastAccessedAt: 0,
	createdAt: 0,
	mode: "tab",
	...overrides,
});

const servicesFor = (value: WebSession, renderReady = true): WebToolServices =>
	({
		webBrowser: {
			openSession: async () => ({
				session: value,
				disposable: false,
				renderReady,
			}),
			getOrOpenSession: async () => ({
				session: value,
				disposable: false,
				renderReady,
			}),
			refreshSession: async () => value,
			closeSession: async () => {},
			getCapabilities: () => ({
				canOpenSession: true,
				canQueryDom: true,
				canPerformDomAction: true,
				canWaitForDom: true,
				canWaitForRender: true,
				canFetchRenderedFallback: true,
				canManageMultipleSessions: true,
			}),
		},
	}) as unknown as WebToolServices;

const parse = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

describe("web tools reporting a bot wall", () => {
	it("reports the wall and the handle needed to hand it to the user", async () => {
		const blocked = session({
			block: { kind: "cloudflare", marker: "browser_check" },
			tabId: 7,
		});
		const tool = createWebOpenTool(servicesFor(blocked));

		const payload = parse(
			await tool.execute({ url: "https://example.test/article" } as never),
		);

		expect(payload.blocked).toEqual({
			kind: "cloudflare",
			marker: "browser_check",
			description: expect.stringContaining("Cloudflare"),
		});
		// The handoff button cannot take the page over without this.
		expect(payload.tabId).toBe(7);
	});

	it("still reports the wall when the page also timed out", async () => {
		const blocked = session({
			block: { kind: "captcha", marker: "captcha" },
			tabId: 3,
		});
		const tool = createWebOpenTool(servicesFor(blocked, false));

		const payload = parse(
			await tool.execute({ url: "https://example.test/article" } as never),
		);

		expect(payload.renderReady).toBe(false);
		expect((payload.blocked as { kind: string }).kind).toBe("captcha");
	});

	it("omits the fields entirely for a healthy page", async () => {
		const clean = session({
			title: "Real Article",
			text: "The actual content of the page.",
			block: null,
			tabId: 4,
		});
		const tool = createWebOpenTool(servicesFor(clean));

		const payload = parse(
			await tool.execute({ url: "https://example.test/article" } as never),
		);

		expect(payload).not.toHaveProperty("blocked");
		// tabId rides along with the block, so a clean read leaks no transport handle.
		expect(payload).not.toHaveProperty("tabId");
	});

	it("reports the wall from web_read too", async () => {
		const blocked = session({
			block: { kind: "rate-limit", marker: "unusual_traffic" },
			tabId: 9,
		});
		const tool = createWebReadTool(servicesFor(blocked));

		const payload = parse(
			await tool.execute({ sessionId: "session-1" } as never),
		);

		expect((payload.blocked as { kind: string }).kind).toBe("rate-limit");
		expect(payload.tabId).toBe(9);
	});
});
