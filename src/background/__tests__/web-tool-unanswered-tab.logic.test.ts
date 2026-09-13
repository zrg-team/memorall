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

const TAB_ID = 7;
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

type Reply = "never" | "closed" | "answer";

/**
 * A tab whose content script replies as scripted, one entry per message. A
 * `never` reply is what a tab the browser froze in the background, or one whose
 * renderer is stuck, gives: the message is accepted and simply never answered.
 */
const installChrome = ({
	replies,
	tabState = {},
}: {
	replies: Reply[];
	tabState?: Record<string, unknown>;
}) => {
	const script = [...replies];
	const sendMessage = vi.fn(() => {
		const reply = script.length > 1 ? script.shift() : script[0];
		if (reply === "never") return new Promise(() => {});
		if (reply === "closed") {
			return Promise.reject(
				new Error(
					"A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
				),
			);
		}
		return Promise.resolve(snapshotReply);
	});
	const executeScript = vi.fn(async () => [{ result: null }]);
	const remove = vi.fn(async () => undefined);
	let messageListener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: unknown) => void,
		  ) => boolean)
		| null = null;
	const session = new Map<string, unknown>();
	const tab = { id: TAB_ID, url: PAGE_URL, status: "complete", ...tabState };

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
			create: vi.fn(async () => tab),
			get: vi.fn(async () => tab),
			sendMessage,
			remove,
			onUpdated: { addListener: vi.fn() },
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

	const dispatch = (message: Record<string, unknown>) =>
		new Promise<WebBrowserCommandResponse>((resolve) => {
			if (!messageListener) throw new Error("No message listener registered.");
			messageListener(
				{ source: WEB_BROWSER_COMMAND_SOURCE, sessionId: "s", ...message },
				{},
				(response) => resolve(response as WebBrowserCommandResponse),
			);
		});

	return { sendMessage, executeScript, remove, dispatch };
};

const register = async () => {
	vi.resetModules();
	const { registerWebToolBrowserHandler } = await import(
		"../web-tool-browser-handler"
	);
	registerWebToolBrowserHandler();
};

const timed = async <T>(work: Promise<T>) => {
	const startedAt = Date.now();
	const value = await work;
	return { value, elapsedMs: Date.now() - startedAt };
};

/**
 * Before this, one unanswered message held the command until the browser shut
 * the service worker down at five minutes, and the agent got only "A listener
 * indicated an asynchronous response by returning true, but the message channel
 * closed before a response was received" — on a page the user could see.
 */
describe("a tab that never answers", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("ends a snapshot at its deadline with a reason the user can act on", async () => {
		const harness = installChrome({ replies: ["never"] });
		await register();

		const { value, elapsedMs } = await timed(
			harness.dispatch({
				command: "snapshot",
				tabId: TAB_ID,
				timeoutMs: 300,
				maxHtmlChars: 1_000,
			}),
		);

		expect(elapsedMs).toBeLessThan(2_000);
		expect(value.success).toBe(false);
		expect(value.success === false && value.error).toContain(
			"did not answer in time",
		);
		expect(value.success === false && value.error).toContain(
			"Switch to the tab",
		);
	});

	it("ends an open at its deadline and leaves the tab for the user to wake", async () => {
		const harness = installChrome({ replies: ["never"] });
		await register();

		const { value, elapsedMs } = await timed(
			harness.dispatch({
				command: "open",
				url: PAGE_URL,
				mode: "tab",
				timeoutMs: 600,
				maxHtmlChars: 1_000,
			}),
		);

		expect(elapsedMs).toBeLessThan(3_000);
		expect(value.success).toBe(false);
		expect(value.success === false && value.error).toContain(
			"did not answer in time",
		);
		expect(harness.remove).not.toHaveBeenCalled();
	});

	it("names the browser's reason when it reports the tab frozen", async () => {
		const harness = installChrome({
			replies: ["never"],
			tabState: { frozen: true },
		});
		await register();

		const value = await harness.dispatch({
			command: "snapshot",
			tabId: TAB_ID,
			timeoutMs: 300,
			maxHtmlChars: 1_000,
		});

		expect(value.success === false && value.error).toContain(
			"frozen this background tab",
		);
	});
});

describe("a page that goes away while it holds the reply", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it("waits for the next document instead of failing the command", async () => {
		const harness = installChrome({ replies: ["closed", "answer"] });
		await register();

		const value = await harness.dispatch({
			command: "snapshot",
			tabId: TAB_ID,
			timeoutMs: 2_000,
			maxHtmlChars: 1_000,
		});

		expect(value.success).toBe(true);
		expect(harness.sendMessage).toHaveBeenCalledTimes(2);
		// The new document brings its own content script; injecting another
		// into it would register a second listener.
		expect(harness.executeScript).not.toHaveBeenCalled();
	});
});
