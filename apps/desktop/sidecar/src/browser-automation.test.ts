import { describe, expect, it } from "vitest";
import {
	BLANK_PAGE_URL,
	checkedHttpUrl,
	checkedPageUrl,
} from "./browser-runtime-types";
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

/**
 * Turning the co-agent on with no page picked opens an empty tab, and that
 * failed outright: every backend validated the URL as HTTP(S) and refused
 * `about:blank`, so activation died with UNSUPPORTED_URL_SCHEME on both
 * engines.
 *
 * The validation is a security boundary — URLs usually come from the agent,
 * which web content can steer — so the fix admits exactly one extra page for
 * opening, and leaves navigation as strict as it was.
 */
describe("opening a blank page for the co-agent", () => {
	it("opens on the blank page it asks for", () => {
		expect(CO_AGENT_START_URL).toBe(BLANK_PAGE_URL);
		expect(checkedPageUrl(CO_AGENT_START_URL)).toBe("about:blank");
	});

	it("still passes ordinary web pages through unchanged", () => {
		expect(checkedPageUrl("https://example.test/a?b=1")).toBe(
			"https://example.test/a?b=1",
		);
	});

	it.each([
		["another about: page", "about:config"],
		["the blank page with a fragment", "about:blank#x"],
		["a different casing", "ABOUT:BLANK"],
		["a script URL", "javascript:alert(1)"],
		["a local file", "file:///C:/Windows/win.ini"],
		["a browser-internal page", "chrome://settings"],
		["a data URL", "data:text/html,<script>1</script>"],
	])("refuses %s", (_label, url) => {
		// One exact string is allowed, not the scheme: anything else here would
		// let steered agent input reach pages it has no business opening.
		expect(() => checkedPageUrl(url)).toThrow();
	});

	it("keeps navigation limited to HTTP(S), blank page included", () => {
		// Only *opening* gained the blank page. Navigating an existing page still
		// goes through the strict check.
		expect(() => checkedHttpUrl(BLANK_PAGE_URL)).toThrow(
			/only supports HTTP\(S\)/,
		);
	});

	it("still refuses credentials embedded in a URL", () => {
		expect(() => checkedPageUrl("https://user:pass@example.test")).toThrow(
			/Credentials embedded/,
		);
	});
});
