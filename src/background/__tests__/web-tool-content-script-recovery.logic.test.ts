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

const TAB_ID = 42;
const PAGE_URL = "https://batdongsan.com.vn/some-listing-pr46112113";

const snapshotReply = {
	source: WEB_CONTENT_COMMAND_SOURCE,
	type: "web-tool:snapshot-result",
	success: true,
	snapshot: {
		url: PAGE_URL,
		title: "Listing",
		html: "<html></html>",
		text: "Listing",
		domAccessible: true,
	},
};

/**
 * Stands in for a tab whose content script never auto-injected — the state a
 * withheld site-access setting, a torn-down world or a module-level throw all
 * leave behind. `sendMessage` fails with Chrome's wording until something puts
 * the script there.
 */
const installChrome = ({
	injectable,
	siteAccess,
}: {
	injectable: boolean;
	/** Omitted: no permissions API, as on a surface that cannot tell. */
	siteAccess?: boolean;
}) => {
	let hasContentScript = false;
	let permissionAdded: (() => void) | null = null;
	const executeScript = vi.fn(async (injection: { files?: string[] }) => {
		if (!injectable) throw new Error("Cannot access contents of the page.");
		// Only injecting the content script's files gives the tab a listener;
		// the keep-awake injection is a function and does not.
		if (injection.files) hasContentScript = true;
		return [{ result: null }];
	});
	const contentScriptInjections = () =>
		executeScript.mock.calls.filter(([injection]) => injection.files);
	const sendMessage = vi.fn(async () => {
		if (!hasContentScript) {
			throw new Error(
				"Could not establish connection. Receiving end does not exist.",
			);
		}
		return snapshotReply;
	});

	let messageListener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: unknown) => void,
		  ) => boolean)
		| null = null;

	const session = new Map<string, unknown>();

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
		},
		tabs: {
			create: vi.fn(async () => ({
				id: TAB_ID,
				url: PAGE_URL,
				status: "complete",
			})),
			get: vi.fn(async () => ({
				id: TAB_ID,
				url: PAGE_URL,
				status: "complete",
			})),
			sendMessage,
			remove: vi.fn(async () => undefined),
			onUpdated: { addListener: vi.fn() },
			onRemoved: { addListener: vi.fn() },
		},
		scripting: { executeScript },
		...(siteAccess === undefined
			? {}
			: {
					permissions: {
						contains: vi.fn(async () => siteAccess),
						onAdded: {
							addListener: vi.fn((listener: () => void) => {
								permissionAdded = listener;
							}),
						},
					},
				}),
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

	return {
		executeScript,
		contentScriptInjections,
		sendMessage,
		grantSiteAccess: () => {
			siteAccess = true;
			permissionAdded?.();
		},
		dispatchOpen: async (
			timeoutMs = 5_000,
		): Promise<WebBrowserCommandResponse> => {
			if (!messageListener) throw new Error("No message listener registered.");
			return new Promise((resolve) => {
				messageListener?.(
					{
						source: WEB_BROWSER_COMMAND_SOURCE,
						command: "open",
						sessionId: "session-1",
						url: PAGE_URL,
						mode: "tab",
						timeoutMs,
						maxHtmlChars: Number.MAX_SAFE_INTEGER,
					},
					{},
					(response) => resolve(response as WebBrowserCommandResponse),
				);
			});
		},
	};
};

const loadHandler = async () => {
	vi.resetModules();
	return import("../web-tool-browser-handler");
};

describe("web tool recovery when a tab has no content script", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("re-injects the declared content script and completes the open", async () => {
		const harness = installChrome({ injectable: true });
		const { registerWebToolBrowserHandler } = await loadHandler();
		registerWebToolBrowserHandler();

		const response = await harness.dispatchOpen();

		expect(harness.executeScript).toHaveBeenCalledWith({
			target: { tabId: TAB_ID, allFrames: false },
			files: ["content_scripts/content-0.js"],
		});
		expect(response.success).toBe(true);
	});

	it("injects at most once per tab rather than on every retry", async () => {
		const harness = installChrome({ injectable: false });
		const { registerWebToolBrowserHandler } = await loadHandler();
		registerWebToolBrowserHandler();

		const response = await harness.dispatchOpen(1_200);

		expect(response.success).toBe(false);
		expect(harness.contentScriptInjections()).toHaveLength(1);
		// Many sendMessage attempts, one injection attempt.
		expect(harness.sendMessage.mock.calls.length).toBeGreaterThan(1);
	});

	it("tells the user what to check when injection cannot help", async () => {
		const harness = installChrome({ injectable: false });
		const { registerWebToolBrowserHandler } = await loadHandler();
		registerWebToolBrowserHandler();

		const response = await harness.dispatchOpen(1_200);

		expect(response.success).toBe(false);
		expect(response.success === false && response.error).toContain(
			"on all sites",
		);
	});

	it("reports withheld site access at once, without injecting", async () => {
		const harness = installChrome({ injectable: false, siteAccess: false });
		const { registerWebToolBrowserHandler } = await loadHandler();
		registerWebToolBrowserHandler();

		const startedAt = Date.now();
		const response = await harness.dispatchOpen(5_000);

		expect(response.success).toBe(false);
		expect(response.success === false && response.error).toContain(
			"Site access withheld for batdongsan.com.vn",
		);
		expect(harness.contentScriptInjections()).toHaveLength(0);
		// Not the whole deadline: nothing a retry does can change the answer.
		expect(Date.now() - startedAt).toBeLessThan(2_000);
	});

	it("injects again once site access is granted back", async () => {
		const harness = installChrome({ injectable: true, siteAccess: false });
		const { registerWebToolBrowserHandler } = await loadHandler();
		registerWebToolBrowserHandler();

		expect((await harness.dispatchOpen(1_200)).success).toBe(false);
		harness.grantSiteAccess();
		const response = await harness.dispatchOpen();

		expect(response.success).toBe(true);
		expect(harness.contentScriptInjections()).toHaveLength(1);
	});
});
