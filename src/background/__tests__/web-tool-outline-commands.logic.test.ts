import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	WEB_BROWSER_COMMAND_SOURCE,
	WEB_CONTENT_COMMAND_SOURCE,
	type WebBrowserCommandRequest,
	type WebBrowserCommandResponse,
} from "@/services/web-browser/web-browser-protocol";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

const TAB_ID = 7;
const PAGE_URL = "https://example.com/article";

const outline = {
	url: PAGE_URL,
	title: "Article",
	docToken: "doc-1",
	blocks: [{ kind: "heading", level: 1, text: "Article" }],
	omittedAbove: 0,
	omittedBelow: 0,
	scroll: { y: 0, viewportHeight: 800, pageHeight: 800 },
};

const installChrome = (
	onSendMessage: (message: { type: string }) => Promise<unknown>,
) => {
	let listener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: unknown) => void,
		  ) => boolean)
		| null = null;
	const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) =>
		onSendMessage(message),
	);
	const tab = { id: TAB_ID, url: PAGE_URL, status: "complete" };
	const tabs = {
		get: vi.fn(async () => tab),
		sendMessage,
		goBack: vi.fn(async () => undefined),
		goForward: vi.fn(async () => undefined),
		update: vi.fn(async () => tab),
		onUpdated: { addListener: vi.fn() },
		onRemoved: { addListener: vi.fn() },
	};
	vi.stubGlobal("chrome", {
		runtime: {
			getManifest: () => ({ content_scripts: [{ js: ["content.js"] }] }),
			onMessage: {
				addListener: vi.fn((next) => {
					listener = next;
				}),
			},
		},
		tabs,
		scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
		storage: {
			session: {
				get: vi.fn(async () => ({})),
				set: vi.fn(async () => undefined),
				remove: vi.fn(async () => undefined),
			},
		},
	});
	return {
		tabs,
		sendMessage,
		dispatch: (request: Record<string, unknown>) =>
			new Promise<WebBrowserCommandResponse>((resolve) => {
				listener?.(
					{
						source: WEB_BROWSER_COMMAND_SOURCE,
						sessionId: "session-1",
						tabId: TAB_ID,
						timeoutMs: 3_000,
						...request,
					} as WebBrowserCommandRequest,
					{},
					(response) => resolve(response as WebBrowserCommandResponse),
				);
			}),
	};
};

const register = async () => {
	vi.resetModules();
	const { registerWebToolBrowserHandler } = await import(
		"../web-tool-browser-handler"
	);
	registerWebToolBrowserHandler();
};

describe("outline browser commands", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns the content script's outline", async () => {
		const harness = installChrome(async () => ({
			source: WEB_CONTENT_COMMAND_SOURCE,
			type: "web-tool:outline-result",
			success: true,
			outline,
		}));
		await register();

		const response = await harness.dispatch({
			command: "outline",
			maxChars: 4_000,
		});

		expect(response).toMatchObject({
			success: true,
			command: "outline",
			outline,
		});
		expect(harness.sendMessage).toHaveBeenCalledWith(TAB_ID, {
			source: WEB_CONTENT_COMMAND_SOURCE,
			type: "web-tool:outline",
			maxChars: 4_000,
		});
	});

	it("sends an action once and treats a closed channel as a navigation", async () => {
		const harness = installChrome(async () => {
			throw new Error(
				"A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
			);
		});
		await register();

		const response = await harness.dispatch({
			command: "outline-action",
			maxChars: 4_000,
			request: { ref: "b3", docToken: "doc-1", action: "click" },
		});

		// Replaying the click on the next page would act on a stranger's element.
		expect(harness.sendMessage).toHaveBeenCalledTimes(1);
		expect(response).toMatchObject({
			success: true,
			command: "outline-action",
			result: { ok: true, action: "click", ref: "b3" },
		});
	});

	it("goes back through the tab's own history and snapshots the page", async () => {
		const harness = installChrome(async () => ({
			source: WEB_CONTENT_COMMAND_SOURCE,
			type: "web-tool:snapshot-result",
			success: true,
			snapshot: {
				url: PAGE_URL,
				title: "Article",
				html: "<html></html>",
				text: "Article",
				domAccessible: true,
			},
		}));
		await register();

		const response = await harness.dispatch({
			command: "history",
			direction: "back",
			maxHtmlChars: 1_000,
		});

		expect(harness.tabs.goBack).toHaveBeenCalledWith(TAB_ID);
		expect(response).toMatchObject({ success: true, command: "history" });
	});
});
