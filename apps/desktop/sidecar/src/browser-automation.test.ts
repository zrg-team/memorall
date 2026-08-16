import { describe, expect, it } from "vitest";
import {
	BrowserAutomationError,
	parseBrowserCommand,
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
