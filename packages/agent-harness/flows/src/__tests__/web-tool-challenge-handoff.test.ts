/**
 * @vitest-environment jsdom
 *
 * `web_read` parses HTML with DOMParser, so these need a DOM.
 */
import { describe, expect, it, vi } from "vitest";
import type { WebSession } from "../interfaces/services/web-browser.js";
import { createWebOpenTool } from "../tools/web/web-open.js";
import type { WebToolServices } from "../tools/web/web-tool-utils.js";
import { setHtmlParser } from "../utils/html-parser.js";

setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));

const blockedSession = (overrides: Partial<WebSession> = {}): WebSession =>
	({
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
		tabId: 7,
		block: { kind: "cloudflare", marker: "browser_check" },
		...overrides,
	}) as WebSession;

const clearedSession = (): WebSession =>
	blockedSession({
		title: "Real Article",
		text: "The actual content of the page.",
		block: null,
	});

interface Harness {
	services: WebToolServices;
	awaitChallengeResolution: ReturnType<typeof vi.fn>;
	refreshSession: ReturnType<typeof vi.fn>;
	closeSession: ReturnType<typeof vi.fn>;
	openSession: ReturnType<typeof vi.fn>;
}

const harness = (options: {
	opened: WebSession;
	/** Sessions returned by successive refreshes, in order. */
	refreshes?: WebSession[];
	resolutions?: Array<{ outcome: "retry" | "skip" | "cancel" }>;
	disposable?: boolean;
	withHandoff?: boolean;
}): Harness => {
	const refreshes = [...(options.refreshes ?? [])];
	const resolutions = [...(options.resolutions ?? [])];

	const refreshSession = vi.fn(async () => refreshes.shift() ?? options.opened);
	const awaitChallengeResolution = vi.fn(
		async () => resolutions.shift() ?? { outcome: "skip" as const },
	);
	const closeSession = vi.fn(async () => {});
	const openSession = vi.fn(async () => ({
		session: options.opened,
		disposable: options.disposable ?? false,
		renderReady: true,
	}));

	const webBrowser: Record<string, unknown> = {
		openSession,
		getOrOpenSession: openSession,
		refreshSession,
		closeSession,
		getCapabilities: () => ({ canAwaitUserIntervention: true }),
	};
	if (options.withHandoff !== false) {
		webBrowser.awaitChallengeResolution = awaitChallengeResolution;
	}

	return {
		services: { webBrowser } as unknown as WebToolServices,
		awaitChallengeResolution,
		refreshSession,
		closeSession,
		openSession,
	};
};

const parse = (raw: string) => JSON.parse(raw) as Record<string, unknown>;
const run = (h: Harness) =>
	createWebOpenTool(h.services).execute(
		{ url: "https://example.test/article" } as never,
		{ state: {}, toolCallId: "call-1" } as never,
	);

describe("waiting for the user to clear a bot wall", () => {
	it("asks the user, then reports the page that appears once they have", async () => {
		const h = harness({
			opened: blockedSession(),
			refreshes: [clearedSession()],
			resolutions: [{ outcome: "retry" }],
		});

		const payload = parse(await run(h));

		expect(h.awaitChallengeResolution).toHaveBeenCalledWith({
			sessionId: "session-1",
			tool: "web_open",
			toolCallId: "call-1",
		});
		// The retry is a refresh of the same tab, never a second open: the user
		// solved the challenge in the tab the session already owns.
		expect(h.refreshSession).toHaveBeenCalledTimes(1);
		expect(h.openSession).toHaveBeenCalledTimes(1);
		expect(payload).not.toHaveProperty("blocked");
		expect(payload.title).toBe("Real Article");
	});

	it("reports the wall unchanged when the user skips", async () => {
		const h = harness({
			opened: blockedSession(),
			resolutions: [{ outcome: "skip" }],
		});

		const payload = parse(await run(h));

		expect(h.refreshSession).not.toHaveBeenCalled();
		expect((payload.blocked as { kind: string }).kind).toBe("cloudflare");
		expect(payload.tabId).toBe(7);
	});

	it("gives up after three rounds rather than asking forever", async () => {
		const h = harness({
			opened: blockedSession(),
			refreshes: [blockedSession(), blockedSession(), blockedSession()],
			resolutions: [
				{ outcome: "retry" },
				{ outcome: "retry" },
				{ outcome: "retry" },
			],
		});

		const payload = parse(await run(h));

		expect(h.awaitChallengeResolution).toHaveBeenCalledTimes(3);
		expect((payload.blocked as { kind: string }).kind).toBe("cloudflare");
	});

	it("never asks on an embedded session, which has no window to raise", async () => {
		const h = harness({ opened: blockedSession({ mode: "iframe" }) });

		const payload = parse(await run(h));

		expect(h.awaitChallengeResolution).not.toHaveBeenCalled();
		expect(payload).toHaveProperty("blocked");
	});

	it("does nothing on a backend that cannot ask", async () => {
		const h = harness({ opened: blockedSession(), withHandoff: false });

		const payload = parse(await run(h));

		expect((payload.blocked as { kind: string }).kind).toBe("cloudflare");
	});

	it("does not ask at all for a healthy page", async () => {
		const h = harness({ opened: clearedSession() });

		const payload = parse(await run(h));

		expect(h.awaitChallengeResolution).not.toHaveBeenCalled();
		expect(payload).not.toHaveProperty("blocked");
	});

	it("keeps a disposable session alive so the handoff has a page to raise", async () => {
		const h = harness({
			opened: blockedSession(),
			disposable: true,
			resolutions: [{ outcome: "skip" }],
		});

		await run(h);

		// Closing it in the finally would destroy the very tab the user was asked
		// to go and solve.
		expect(h.closeSession).not.toHaveBeenCalled();
	});

	it("closes a disposable session as usual when nothing was blocking", async () => {
		const h = harness({ opened: clearedSession(), disposable: true });

		await run(h);

		expect(h.closeSession).toHaveBeenCalledWith("session-1");
	});
});
