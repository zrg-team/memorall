import { describe, expect, it } from "vitest";
import {
	BrowserAutomationError,
	CO_AGENT_START_URL,
	parseBrowserCommand,
	planCoAgentAttachment,
} from "./browser-automation";

const openRequest = (url: string) => ({
	source: "memorall:web-browser-command",
	command: "open",
	sessionId: "session-1",
	url,
	mode: "tab",
	timeoutMs: 1_000,
	maxHtmlChars: 10_000,
});

describe("desktop browser command validation", () => {
	it("accepts the existing web browser request schema", () => {
		expect(
			parseBrowserCommand(openRequest("https://example.com")),
		).toMatchObject({
			command: "open",
			sessionId: "session-1",
		});
	});

	it("rejects unknown commands and malformed fields", () => {
		expect(() =>
			parseBrowserCommand({
				...openRequest("https://example.com"),
				command: "eval",
			}),
		).toThrow(BrowserAutomationError);
		expect(() =>
			parseBrowserCommand({
				...openRequest("https://example.com"),
				timeoutMs: "soon",
			}),
		).toThrow("timeoutMs");
	});

	it("does not expose non-browser sidecar methods through browser.command", () => {
		expect(() =>
			parseBrowserCommand({
				source: "memorall:web-browser-command",
				command: "workspace.read",
				sessionId: "session-1",
			}),
		).toThrow("Unsupported browser command");
	});
});

/**
 * Desktop's co-agent used to have a second surface that drove Memorall's own
 * window, and switching it on without naming a page went there. Now there is
 * only the managed browser, so the same gesture has to produce a page — which
 * is what this decides.
 */
describe("co-agent attachment", () => {
	it("opens a blank page when the browser has none", () => {
		// Previously this threw CO_AGENT_NO_MANAGED_PAGE, which is what made
		// turning the co-agent on look like it did nothing.
		expect(
			planCoAgentAttachment({
				requestedTabId: null,
				url: null,
				openTabIds: [],
			}),
		).toEqual({ tabId: null, openUrl: CO_AGENT_START_URL });
	});

	it("attaches to the page the user is already looking at", () => {
		expect(
			planCoAgentAttachment({
				requestedTabId: null,
				url: null,
				openTabIds: [1, 2, 7],
			}),
		).toEqual({ tabId: 7, openUrl: null });
	});

	it("always opens a URL it was given, even with pages open", () => {
		// A URL comes from a link the user clicked; attaching to some other page
		// instead would silently ignore what they asked for.
		expect(
			planCoAgentAttachment({
				requestedTabId: null,
				url: "https://example.test",
				openTabIds: [1, 2],
			}),
		).toEqual({ tabId: null, openUrl: "https://example.test" });
	});

	it("honours an explicit tab over everything else", () => {
		expect(
			planCoAgentAttachment({
				requestedTabId: 3,
				url: "https://example.test",
				openTabIds: [1, 2],
			}),
		).toEqual({ tabId: 3, openUrl: null });
	});
});
