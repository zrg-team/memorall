import { afterEach, describe, expect, it, vi } from "vitest";
import {
	WEB_BROWSER_COMMAND_SOURCE,
	WEB_CONTENT_COMMAND_SOURCE,
} from "@/services/web-browser/web-browser-protocol";
import {
	AGENT_TAB_AWAKE_LOCK,
	holdAwakeLock,
	keepAgentTabAwake,
} from "../keep-agent-tab-awake";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

afterEach(() => {
	vi.unstubAllGlobals();
});

/**
 * Edge froze a background agent tab after 30 seconds and its content script
 * stopped answering; the same tab holding a shared Web Lock stayed awake and
 * answered at once. These pin down how the lock is taken.
 */
describe("the lock a page holds to stay awake", () => {
	const installPage = (locks: unknown) => {
		const page: Record<string, unknown> = {};
		vi.stubGlobal("window", page);
		vi.stubGlobal("navigator", { locks });
		return page;
	};

	it("is shared, so agent tabs on the same site do not queue behind each other", () => {
		const request = vi.fn(() => new Promise(() => {}));
		installPage({ request });

		expect(holdAwakeLock(AGENT_TAB_AWAKE_LOCK)).toBe(true);

		expect(request).toHaveBeenCalledWith(
			AGENT_TAB_AWAKE_LOCK,
			{ mode: "shared" },
			expect.any(Function),
		);
	});

	it("is taken once per document, however often it is asked for", () => {
		const request = vi.fn(() => new Promise(() => {}));
		installPage({ request });

		holdAwakeLock(AGENT_TAB_AWAKE_LOCK);
		holdAwakeLock(AGENT_TAB_AWAKE_LOCK);

		expect(request).toHaveBeenCalledTimes(1);
	});

	it("is never released while the document lives", async () => {
		let release: Promise<unknown> | undefined;
		installPage({
			request: vi.fn((_name, _options, callback: () => Promise<unknown>) => {
				release = callback();
				return release;
			}),
		});

		holdAwakeLock(AGENT_TAB_AWAKE_LOCK);
		const settled = await Promise.race([
			release?.then(() => "released"),
			new Promise((resolve) => setTimeout(() => resolve("held"), 50)),
		]);

		expect(settled).toBe("held");
	});

	it("reports that a page without Web Locks cannot be kept awake", () => {
		// Plain-HTTP pages: Web Locks need a secure context.
		installPage(undefined);

		expect(holdAwakeLock(AGENT_TAB_AWAKE_LOCK)).toBe(false);
	});
});

describe("keeping a tab awake from the background", () => {
	it("does not wait on a tab that cannot run the script", async () => {
		vi.stubGlobal("chrome", {
			scripting: { executeScript: vi.fn(() => new Promise(() => {})) },
		});

		const startedAt = Date.now();
		expect(await keepAgentTabAwake(1, 50)).toBe(false);
		expect(Date.now() - startedAt).toBeLessThan(1_000);
	});

	it("does not throw for a tab it may not script", async () => {
		vi.stubGlobal("chrome", {
			scripting: {
				executeScript: vi.fn(async () => {
					throw new Error("Cannot access a chrome:// URL");
				}),
			},
		});

		expect(await keepAgentTabAwake(1)).toBe(false);
	});
});

describe("which tabs the web tools keep awake", () => {
	const TAB_ID = 11;
	const PAGE_URL = "https://example.test/listing";

	const installChrome = () => {
		const executeScript = vi.fn(
			async (_injection: { args?: unknown[]; target: { tabId: number } }) => [
				{ result: true },
			],
		);
		let messageListener:
			| ((
					message: unknown,
					sender: unknown,
					reply: (r: unknown) => void,
			  ) => boolean)
			| null = null;
		let updatedListener:
			| ((tabId: number, changeInfo: { status?: string }) => void)
			| null = null;
		const session = new Map<string, unknown>();

		vi.stubGlobal("chrome", {
			runtime: {
				getManifest: () => ({ content_scripts: [{ js: ["content.js"] }] }),
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
				sendMessage: vi.fn(async () => ({
					source: WEB_CONTENT_COMMAND_SOURCE,
					type: "web-tool:snapshot-result",
					success: true,
					snapshot: {
						url: PAGE_URL,
						title: "",
						html: "",
						text: "",
						domAccessible: true,
					},
				})),
				remove: vi.fn(async () => undefined),
				onUpdated: {
					addListener: vi.fn((listener) => {
						// The injection-recovery listener registers first; the last one
						// is the web tools' own.
						updatedListener = listener;
					}),
				},
				onRemoved: { addListener: vi.fn() },
			},
			scripting: { executeScript },
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

		const awakeInjections = (tabId: number) =>
			executeScript.mock.calls.filter(
				([injection]) =>
					// The handler is re-imported per test, so match the lock it asks
					// for rather than the identity of the function it injects.
					injection.args?.[0] === AGENT_TAB_AWAKE_LOCK &&
					injection.target.tabId === tabId,
			);

		return {
			awakeInjections,
			open: () =>
				new Promise((resolve) => {
					messageListener?.(
						{
							source: WEB_BROWSER_COMMAND_SOURCE,
							command: "open",
							sessionId: "session-1",
							url: PAGE_URL,
							mode: "tab",
							timeoutMs: 2_000,
							maxHtmlChars: 1_000,
						},
						{},
						resolve,
					);
				}),
			pageLoaded: (tabId: number) =>
				updatedListener?.(tabId, { status: "complete" }),
		};
	};

	const register = async () => {
		vi.resetModules();
		const handler = await import("../web-tool-browser-handler");
		handler.registerWebToolBrowserHandler();
	};

	const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

	it("keeps the tab an open created awake", async () => {
		const harness = installChrome();
		await register();

		await harness.open();

		expect(harness.awakeInjections(TAB_ID)).toHaveLength(1);
	});

	it("takes the lock again when a session's tab loads a new page", async () => {
		const harness = installChrome();
		await register();
		await harness.open();

		harness.pageLoaded(TAB_ID);
		await settle();

		expect(harness.awakeInjections(TAB_ID)).toHaveLength(2);
	});

	it("leaves the user's own tabs alone", async () => {
		const harness = installChrome();
		await register();
		await harness.open();

		harness.pageLoaded(99);
		await settle();

		expect(harness.awakeInjections(99)).toHaveLength(0);
	});
});
