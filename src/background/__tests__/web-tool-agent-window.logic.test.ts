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

const captures = vi.hoisted(() => ({
	visible: vi.fn(
		async (_windowId: number) =>
			`data:image/png;base64,${Buffer.alloc(24).toString("base64")}`,
	),
	area: vi.fn(async () => ({
		dataUrl: "data:image/png;base64,",
		width: 100,
		height: 100,
	})),
}));
vi.mock("../tab-screenshot", () => ({
	captureVisible: captures.visible,
	captureTabArea: captures.area,
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
	const tabs = new Map<
		number,
		{
			id: number;
			windowId: number;
			url: string;
			groupId?: number;
			active: boolean;
		}
	>([
		[100, { id: 100, windowId: 1, url: "https://user.example/", active: true }],
	]);
	let nextWindow = 2;
	let nextTab = 101;
	let nextGroup = 10;
	const groups = new Map<
		number,
		{ id: number; windowId: number; title?: string }
	>();
	const addTab = (windowId: number, url: string, active = false) => {
		const selected = active || windows.get(windowId)?.length === 0;
		if (selected)
			for (const tab of tabs.values()) {
				if (tab.windowId === windowId) tab.active = false;
			}
		const tab = {
			id: nextTab++,
			windowId,
			url,
			status: "complete",
			active: selected,
		};
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
		create: vi.fn(async ({ url, tabId }: { url?: string; tabId?: number }) => {
			const id = nextWindow++;
			windows.set(id, []);
			if (typeof tabId === "number") {
				const tab = tabs.get(tabId);
				if (!tab) throw new Error("No tab.");
				windows.set(
					tab.windowId,
					(windows.get(tab.windowId) ?? []).filter((value) => value !== tabId),
				);
				tab.windowId = id;
				tab.active = true;
				windows.set(id, [tabId]);
				return { id, tabs: [tab] };
			}
			const tab = addTab(id, url ?? "about:blank");
			return { id, tabs: [tab] };
		}),
		get: vi.fn(async (id: number) => {
			if (!windows.has(id)) throw new Error(`No window with id: ${id}.`);
			return { id, focused: id === 1 };
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
				async ({
					url,
					windowId,
					active,
				}: {
					url: string;
					windowId?: number;
					active?: boolean;
				}) => {
					const target = windowId ?? 1;
					if (!windows.has(target))
						throw new Error(`No window with id: ${target}.`);
					return addTab(target, url, active);
				},
			),
			get: vi.fn(async (id: number) => {
				const tab = tabs.get(id);
				if (!tab) throw new Error(`No tab with id: ${id}.`);
				return { ...tab, status: "complete" };
			}),
			query: vi.fn(async ({ windowId }: { windowId?: number }) =>
				typeof windowId === "number"
					? (windows.get(windowId) ?? []).map((id) => tabs.get(id))
					: [...tabs.values()],
			),
			sendMessage: vi.fn(
				async (tabId: number, message: { type: string; url?: string }) => {
					if (message.type === "web-tool:navigate-to-image") {
						const tab = tabs.get(tabId);
						if (tab && message.url) tab.url = message.url;
						return {
							source: WEB_CONTENT_COMMAND_SOURCE,
							type: "web-tool:navigate-to-image-result",
							success: true,
						};
					}
					if (message.type === "web-tool:read-rendered-image")
						return {
							source: WEB_CONTENT_COMMAND_SOURCE,
							type: "web-tool:read-rendered-image-result",
							success: true,
							base64: "AAAA",
							mimeType: "image/png",
							width: 1,
							height: 1,
						};
					return snapshotReply(tabs.get(tabId)?.url ?? "");
				},
			),
			update: vi.fn(async (tabId: number, props: { active?: boolean }) => {
				const tab = tabs.get(tabId);
				if (props.active && tab)
					for (const candidate of tabs.values()) {
						if (candidate.windowId === tab.windowId)
							candidate.active = candidate.id === tabId;
					}
				return tab;
			}),
			group: vi.fn(
				async ({
					tabIds,
					groupId,
					createProperties,
				}: {
					tabIds: number;
					groupId?: number;
					createProperties?: { windowId: number };
				}) => {
					const tab = tabs.get(tabIds);
					if (!tab) throw new Error("No tab.");
					const id = groupId ?? nextGroup++;
					if (groupId === undefined) {
						groups.set(id, {
							id,
							windowId: createProperties?.windowId ?? tab.windowId,
						});
					}
					tab.groupId = id;
					return id;
				},
			),
			remove: vi.fn(async (id: number) => removeTab(id)),
			onUpdated: { addListener: vi.fn() },
			onRemoved: { addListener: vi.fn() },
		},
		tabGroups: {
			get: vi.fn(async (id: number) => {
				const group = groups.get(id);
				if (!group) throw new Error("No group.");
				return group;
			}),
			update: vi.fn(async (id: number, props: { title: string }) => {
				const group = groups.get(id);
				if (group) Object.assign(group, props);
				return group;
			}),
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
		groups,
		tabs,
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
		captures.visible.mockClear();
		captures.area.mockClear();
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
		expect(chrome.tabs.create).toHaveBeenCalledWith(
			expect.objectContaining({ active: false }),
		);
		expect(browser.windowsApi.create).toHaveBeenCalledWith(
			expect.objectContaining({ focused: false }),
		);
		expect(browser.windowsApi.update).not.toHaveBeenCalled();
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		const group = [...browser.groups.values()][0];
		expect(group).toMatchObject({ title: "Memorall", windowId });
		expect(browser.groups.size).toBe(1);
		for (const response of [a, b, c]) {
			expect(browser.tabs.get(surfaceOf(response).tabId)?.groupId).toBe(
				group.id,
			);
		}
	});

	it("groups background tabs without grouping the user's own tab", async () => {
		const browser = installBrowser();
		await register();
		await Promise.all(
			["a", "b"].map((sessionId) =>
				browser.dispatch({
					command: "open",
					sessionId,
					url: `https://${sessionId}.example/`,
					mode: "tab",
					timeoutMs: 2_000,
					maxHtmlChars: 1_000,
				}),
			),
		);

		expect(browser.windowsApi.create).not.toHaveBeenCalled();
		expect(browser.groups.size).toBe(1);
		expect([...browser.groups.values()][0]).toMatchObject({
			title: "Memorall",
			windowId: 1,
		});
		expect(browser.tabs.get(100)?.groupId).toBeUndefined();
		expect(chrome.tabs.update).not.toHaveBeenCalled();
	});

	it("creates a new group when the remembered group has been removed", async () => {
		const browser = installBrowser();
		await register();
		await browser.open("a", "https://a.example/");
		const oldGroup = [...browser.groups.keys()][0];
		browser.groups.delete(oldGroup);
		await browser.open("b", "https://b.example/");

		expect(chrome.tabGroups.update).toHaveBeenCalledTimes(2);
		expect([...browser.groups.keys()][0]).not.toBe(oldGroup);
	});

	it("still opens a page if tab grouping fails", async () => {
		const browser = installBrowser();
		vi.mocked(chrome.tabs.group).mockRejectedValueOnce(
			new Error("Grouping unavailable"),
		);
		await register();

		expect((await browser.open("a", "https://a.example/")).success).toBe(true);
		expect((await browser.open("b", "https://b.example/")).success).toBe(true);
		expect(browser.groups.size).toBe(1);
	});

	it("only brings a page forward on an explicit request", async () => {
		const browser = installBrowser();
		await register();
		const surface = surfaceOf(await browser.open("a", "https://a.example/"));
		await browser.dispatch({
			command: "bring-to-front",
			sessionId: "a",
			tabId: surface.tabId,
		});

		expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(surface.tabId, {
			active: true,
		});
		expect(browser.windowsApi.update).toHaveBeenCalledExactlyOnceWith(
			surface.windowId,
			{ focused: true },
		);
	});

	it("captures a background session without changing the user's selected tab", async () => {
		const browser = installBrowser();
		await register();
		const surface = surfaceOf(
			await browser.dispatch({
				command: "open",
				sessionId: "a",
				url: "https://a.example/",
				mode: "tab",
				timeoutMs: 2_000,
				maxHtmlChars: 1_000,
			}),
		);
		const result = await browser.dispatch({
			command: "screenshot",
			sessionId: "a",
			tabId: surface.tabId,
			windowId: 1,
		});

		expect(result.success).toBe(true);
		expect(browser.tabs.get(100)?.active).toBe(true);
		expect(browser.tabs.get(surface.tabId)?.windowId).not.toBe(1);
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(browser.windowsApi.update).not.toHaveBeenCalled();
		expect(captures.visible).toHaveBeenCalledWith(
			browser.tabs.get(surface.tabId)?.windowId,
		);

		// Closing the moved session must not close the user's original window.
		await browser.dispatch({
			command: "close",
			sessionId: "a",
			tabId: surface.tabId,
			windowId: 1,
		});
		expect(browser.windows.get(1)).toEqual([100]);
	});

	it("captures an already selected agent page without activating anything", async () => {
		const browser = installBrowser();
		await register();
		const surface = surfaceOf(await browser.open("a", "https://a.example/"));
		expect(
			(
				await browser.dispatch({
					command: "screenshot",
					sessionId: "a",
					tabId: surface.tabId,
				})
			).success,
		).toBe(true);
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(browser.windowsApi.update).not.toHaveBeenCalled();
		expect(browser.windowsApi.create).toHaveBeenCalledTimes(1);
	});

	it("does not switch to an unrelated inactive user tab for a screenshot", async () => {
		const browser = installBrowser();
		await register();
		const tab = await chrome.tabs.create({
			url: "https://other.example/",
			active: false,
		});
		expect(
			(
				await browser.dispatch({
					command: "screenshot",
					sessionId: "unknown",
					tabId: tab.id,
				})
			).success,
		).toBe(false);
		expect(browser.tabs.get(100)?.active).toBe(true);
		expect(chrome.tabs.update).not.toHaveBeenCalled();
		expect(captures.visible).not.toHaveBeenCalled();
	});

	it("loads protected images in a temporary background copy of the source page", async () => {
		const browser = installBrowser();
		await register();
		const result = await browser.dispatch({
			command: "capture-image",
			sessionId: "images",
			tabId: 100,
			url: "https://images.example/photo.jpg",
			timeoutMs: 2_000,
		});
		expect(result).toMatchObject({ success: true, base64: "AAAA" });
		expect(chrome.tabs.create).toHaveBeenCalledWith({
			url: "https://user.example/",
			active: false,
			openerTabId: 100,
			windowId: 1,
		});
		expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
			101,
			expect.objectContaining({ type: "web-tool:navigate-to-image" }),
		);
		expect(browser.tabs.get(100)).toMatchObject({
			active: true,
			url: "https://user.example/",
		});
		expect(browser.tabs.has(101)).toBe(false);
		expect(chrome.tabs.update).not.toHaveBeenCalled();
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
		expect(chrome.tabGroups.update).toHaveBeenCalledTimes(1);
		expect(browser.groups.size).toBe(1);
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
