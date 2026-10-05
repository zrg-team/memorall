import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	WEB_BROWSER_COMMAND_SOURCE,
	WEB_CONTENT_COMMAND_SOURCE,
	type WebBrowserCommandResponse,
} from "@/services/web-browser/web-browser-protocol";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

const snapshotReply = (url: string) => ({
	source: WEB_CONTENT_COMMAND_SOURCE,
	type: "web-tool:snapshot-result",
	success: true,
	snapshot: {
		url,
		title: url,
		html: "<html></html>",
		text: url,
		domAccessible: true,
	},
});

/** A browser with real windows and tabs, as far as the handler can tell. */
const installBrowser = () => {
	const windows = new Map<number, number[]>([[1, [100]]]);
	const tabs = new Map<number, { id: number; windowId: number; url: string }>([
		[100, { id: 100, windowId: 1, url: "https://user.example/" }],
	]);
	let nextWindow = 2;
	let nextTab = 101;
	const addTab = (windowId: number, url: string) => {
		const tab = { id: nextTab++, windowId, url, status: "complete" };
		tabs.set(tab.id, tab);
		windows.get(windowId)?.push(tab.id);
		return tab;
	};
	const removeTab = (tabId: number) => {
		const tab = tabs.get(tabId);
		if (!tab) return;
		tabs.delete(tabId);
		const rest = (windows.get(tab.windowId) ?? []).filter((id) => id !== tabId);
		// The browser closes a window with its last tab.
		if (rest.length === 0) windows.delete(tab.windowId);
		else windows.set(tab.windowId, rest);
	};

	let messageListener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: unknown) => void,
		  ) => boolean)
		| null = null;
	const session = new Map<string, unknown>();
	// What the background tells the extension's pages (the offscreen document).
	const runtimeSendMessage = vi.fn(async (_message: unknown) => undefined);
	const windowsApi = {
		create: vi.fn(async ({ url }: { url: string }) => {
			const id = nextWindow++;
			windows.set(id, []);
			const tab = addTab(id, url);
			return { id, tabs: [tab] };
		}),
		get: vi.fn(async (id: number) => {
			if (!windows.has(id)) throw new Error(`No window with id: ${id}.`);
			return { id };
		}),
		getLastFocused: vi.fn(async () => ({ id: 1 })),
		update: vi.fn(async () => ({})),
		remove: vi.fn(async (id: number) => {
			for (const tabId of windows.get(id) ?? []) tabs.delete(tabId);
			windows.delete(id);
		}),
	};

	vi.stubGlobal("chrome", {
		runtime: {
			getManifest: () => ({
				content_scripts: [{ js: ["content_scripts/content-0.js"] }],
			}),
			onMessage: {
				addListener: vi.fn((listener) => {
					messageListener = listener;
				}),
			},
			sendMessage: runtimeSendMessage,
		},
		windows: windowsApi,
		tabs: {
			create: vi.fn(
				async ({ url, windowId }: { url: string; windowId?: number }) => {
					const target = windowId ?? 1;
					if (!windows.has(target))
						throw new Error(`No window with id: ${target}.`);
					return addTab(target, url);
				},
			),
			get: vi.fn(async (id: number) => {
				const tab = tabs.get(id);
				if (!tab) throw new Error(`No tab with id: ${id}.`);
				return { ...tab, status: "complete" };
			}),
			query: vi.fn(async ({ windowId }: { windowId: number }) =>
				(windows.get(windowId) ?? []).map((id) => tabs.get(id)),
			),
			sendMessage: vi.fn(async (tabId: number) =>
				snapshotReply(tabs.get(tabId)?.url ?? ""),
			),
			update: vi.fn(async () => ({})),
			remove: vi.fn(async (id: number) => removeTab(id)),
			onUpdated: { addListener: vi.fn() },
			onRemoved: { addListener: vi.fn() },
		},
		scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
		storage: {
			session: {
				get: vi.fn(async (key: string) => ({ [key]: session.get(key) })),
				set: vi.fn(async (values: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(values))
						session.set(key, value);
				}),
				remove: vi.fn(async (key: string) => {
					session.delete(key);
				}),
			},
		},
	});

	const dispatch = (message: Record<string, unknown>) =>
		new Promise<WebBrowserCommandResponse>((resolve) => {
			if (!messageListener) throw new Error("No message listener registered.");
			messageListener(
				{ source: WEB_BROWSER_COMMAND_SOURCE, ...message },
				{},
				(response) => resolve(response as WebBrowserCommandResponse),
			);
		});
	const open = (sessionId: string, url: string) =>
		dispatch({
			command: "open",
			sessionId,
			url,
			mode: "window",
			timeoutMs: 2_000,
			maxHtmlChars: 1_000,
		});

	/** A message from a page's content script, as the browser delivers it. */
	const sendFromTab = (tabId: number, message: unknown) =>
		messageListener?.(message, { tab: { id: tabId } }, () => undefined);

	return {
		windows,
		windowsApi,
		dispatch,
		open,
		sendFromTab,
		runtimeSendMessage,
	};
};

const register = async () => {
	vi.resetModules();
	const { registerWebToolBrowserHandler } = await import(
		"../web-tool-browser-handler"
	);
	registerWebToolBrowserHandler();
};

const surfaceOf = (response: WebBrowserCommandResponse) => {
	if (!response.success || response.command !== "open")
		throw new Error(JSON.stringify(response));
	return response.surface;
};

describe("the agent's window", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("opens every window-mode page as a tab of one window", async () => {
		const browser = installBrowser();
		await register();

		const [a, b, c] = await Promise.all([
			browser.open("a", "https://a.example/"),
			browser.open("b", "https://b.example/"),
			browser.open("c", "https://c.example/"),
		]);

		expect(browser.windowsApi.create).toHaveBeenCalledTimes(1);
		const windowId = surfaceOf(a).windowId;
		expect(surfaceOf(b)).toMatchObject({ mode: "window", windowId });
		expect(surfaceOf(c)).toMatchObject({ mode: "window", windowId });
		expect(browser.windows.get(windowId as number)).toHaveLength(3);
		// The user's own window is left as it was.
		expect(browser.windows.get(1)).toEqual([100]);
	});

	it("closes a page's tab, and the window only with its last page", async () => {
		const browser = installBrowser();
		await register();
		const windowId = surfaceOf(await browser.open("a", "https://a.example/"))
			.windowId as number;
		await browser.open("b", "https://b.example/");

		await browser.dispatch({ command: "close", sessionId: "a" });
		expect(browser.windows.get(windowId)).toHaveLength(1);
		await browser.dispatch({ command: "close", sessionId: "b" });
		expect(browser.windows.has(windowId)).toBe(false);

		// With the window gone, the next page makes a new one.
		const next = surfaceOf(await browser.open("c", "https://c.example/"));
		expect(next.windowId).not.toBe(windowId);
		expect(browser.windowsApi.create).toHaveBeenCalledTimes(2);
	});

	it("finds the window again after the service worker restarts", async () => {
		const browser = installBrowser();
		await register();
		const windowId = surfaceOf(
			await browser.open("a", "https://a.example/"),
		).windowId;

		await register();
		const after = surfaceOf(await browser.open("b", "https://b.example/"));
		expect(after.windowId).toBe(windowId);
		expect(browser.windowsApi.create).toHaveBeenCalledTimes(1);
	});
});

describe("what the user does in a session's tab", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("leaves the other pages when the user already closed a page's tab", async () => {
		const browser = installBrowser();
		await register();
		const a = surfaceOf(await browser.open("a", "https://a.example/"));
		const b = surfaceOf(await browser.open("b", "https://b.example/"));

		// Closed in the browser: the window now holds only b's tab.
		await chrome.tabs.remove(a.tabId);
		await browser.dispatch({
			command: "close",
			sessionId: "a",
			tabId: a.tabId,
			windowId: a.windowId,
		});

		expect(browser.windows.get(a.windowId as number)).toEqual([b.tabId]);
	});

	it("asks an opened page to report what the user does in it", async () => {
		const browser = installBrowser();
		await register();
		const a = surfaceOf(await browser.open("a", "https://a.example/"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(a.tabId, {
			source: WEB_CONTENT_COMMAND_SOURCE,
			type: "web-tool:watch-user-actions",
		});
	});

	it("passes a session page's clicks on to its session, and nobody else's", async () => {
		const browser = installBrowser();
		await register();
		const a = surfaceOf(await browser.open("a", "https://a.example/"));
		const click = {
			source: "memorall:web-page-action",
			action: { kind: "clicked", target: 'button "Buy"' },
		};

		browser.sendFromTab(a.tabId, click);
		// The user's own tab.
		browser.sendFromTab(100, click);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(browser.runtimeSendMessage).toHaveBeenCalledTimes(1);
		expect(browser.runtimeSendMessage).toHaveBeenCalledWith({
			source: "memorall:web-session-event",
			sessionId: "a",
			event: { kind: "clicked", target: 'button "Buy"' },
		});
	});
});
