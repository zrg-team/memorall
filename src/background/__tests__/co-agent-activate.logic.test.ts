import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	type CoAgentBrowserCommandResponse,
} from "@/services/co-agent/co-agent-protocol";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

const OPTIONS_TAB = {
	id: 1,
	windowId: 10,
	active: true,
	status: "complete",
	url: "chrome-extension://abc/options/index.html",
	title: "Memorall",
	lastAccessed: 500,
};
const PAGE_TAB = {
	id: 2,
	windowId: 10,
	active: false,
	status: "complete",
	url: "https://batdongsan.com.vn/listing",
	title: "Listing",
	lastAccessed: 400,
};
const OLDER_PAGE_TAB = {
	id: 3,
	windowId: 10,
	active: false,
	status: "complete",
	url: "https://example.com/",
	title: "Older",
	lastAccessed: 100,
};

const installChrome = (tabs: Array<Record<string, unknown>>) => {
	const session = new Map<string, unknown>();
	const sent: Array<{ tabId: number; message: unknown }> = [];
	let listener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: unknown) => void,
		  ) => boolean)
		| null = null;

	vi.stubGlobal("chrome", {
		runtime: {
			getManifest: () => ({ content_scripts: [{ js: ["content.js"] }] }),
			onMessage: {
				addListener: vi.fn((fn) => {
					listener = fn;
				}),
			},
		},
		tabs: {
			query: vi.fn(async (info: Record<string, unknown>) =>
				tabs.filter((tab) => (info.active ? tab.active === true : true)),
			),
			get: vi.fn(async (id: number) => {
				const tab = tabs.find((candidate) => candidate.id === id);
				if (!tab) throw new Error("No tab");
				return tab;
			}),
			update: vi.fn(async () => undefined),
			create: vi.fn(async () => ({ id: 99, status: "complete" })),
			sendMessage: vi.fn(async (tabId: number, message: unknown) => {
				sent.push({ tabId, message });
				return { success: true };
			}),
			onUpdated: { addListener: vi.fn() },
			onRemoved: { addListener: vi.fn() },
		},
		windows: { update: vi.fn(async () => undefined) },
		scripting: { executeScript: vi.fn(async () => [{}]) },
		storage: {
			session: {
				get: vi.fn(async (key: string) => ({ [key]: session.get(key) })),
				set: vi.fn(async (values: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(values)) {
						session.set(key, value);
					}
				}),
				remove: vi.fn(async (key: string) => {
					session.delete(key);
				}),
			},
		},
	});

	return {
		sent,
		session,
		activate: async (): Promise<CoAgentBrowserCommandResponse> => {
			if (!listener) throw new Error("No listener registered.");
			return new Promise((resolve) => {
				listener?.(
					{
						source: CO_AGENT_BROWSER_COMMAND_SOURCE,
						command: "activate",
					},
					{},
					(response) => resolve(response as CoAgentBrowserCommandResponse),
				);
			});
		},
	};
};

const loadHandler = async () => {
	vi.resetModules();
	return import("../co-agent-browser-handler");
};

describe("co-agent activate: choosing the tab", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("skips Memorall's own page for the page behind it", async () => {
		// The chat panel IS a tab on the extension, so the active tab is normally
		// the options page. Attaching there would fail; the user means the page
		// they were last on.
		const harness = installChrome([OPTIONS_TAB, PAGE_TAB, OLDER_PAGE_TAB]);
		const { registerCoAgentBrowserHandler } = await loadHandler();
		registerCoAgentBrowserHandler();

		const response = await harness.activate();

		expect(response.success).toBe(true);
		expect(harness.sent.at(-1)?.tabId).toBe(PAGE_TAB.id);
		expect(
			(
				harness.session.get(CO_AGENT_ACTIVE_SESSION_STORAGE_KEY) as {
					tabId: number;
				}
			)?.tabId,
		).toBe(PAGE_TAB.id);
	});

	it("prefers an active real page over a merely recent one", async () => {
		const activePage = { ...PAGE_TAB, active: true, lastAccessed: 1 };
		const harness = installChrome([activePage, OLDER_PAGE_TAB]);
		const { registerCoAgentBrowserHandler } = await loadHandler();
		registerCoAgentBrowserHandler();

		await harness.activate();

		expect(harness.sent.at(-1)?.tabId).toBe(activePage.id);
	});

	it("says so plainly when there is no page to attach to", async () => {
		const harness = installChrome([OPTIONS_TAB]);
		const { registerCoAgentBrowserHandler } = await loadHandler();
		registerCoAgentBrowserHandler();

		const response = await harness.activate();

		expect(response.success).toBe(false);
		expect(response.success === false && response.error).toContain(
			"No open web page",
		);
	});
});
