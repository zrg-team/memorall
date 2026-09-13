import { describe, expect, it } from "vitest";
import { BrowserAutomationManager } from "./browser-automation";
import type { BackendSession, BrowserBackend } from "./browser-backend";
import type { BrowserEngine } from "./browser-runtime-types";
import { CO_AGENT_BROWSER_COMMAND_SOURCE } from "./co-agent-runtime-types";

/**
 * A stand-in engine that records what was asked of it. `canHostCoAgent` mirrors
 * the real split: Chromium over CDP implements the co-agent members, BrowserOS
 * does not.
 */
const fakeEngine = (engine: BrowserEngine, canHostCoAgent: boolean) => {
	const calls: string[] = [];
	let nextHandle = 0;
	const backend: BrowserBackend = {
		engine,
		status: async () => ({ engine, readiness: "ready" }) as never,
		open: async (url) => {
			calls.push(`open ${url}`);
			const session: BackendSession = { engine, handle: ++nextHandle, url };
			return {
				session,
				snapshot: { url, title: "", html: "", text: "", domAccessible: true },
			};
		},
		snapshot: async (session) => ({
			url: session.url,
			title: "",
			html: "",
			text: "",
			domAccessible: true,
		}),
		close: async (session) => {
			calls.push(`close ${session.url}`);
		},
		stop: async () => {},
		...(canHostCoAgent
			? {
					coAgentAttach: async (session: BackendSession) => {
						calls.push(`attach ${session.url}`);
					},
				}
			: {}),
	};
	return { backend, calls };
};

const automationWith = (engines: {
	browseros: BrowserBackend;
	chromium: BrowserBackend;
}) => {
	const automation = new BrowserAutomationManager("unused", { visible: true });
	Object.assign(automation, engines);
	return automation;
};

const webOpen = (url: string) => ({
	source: "memorall:web-browser-command",
	command: "open",
	sessionId: "agent",
	url,
	mode: "window",
	timeoutMs: 1_000,
	maxHtmlChars: 1_000,
});

const activate = {
	source: CO_AGENT_BROWSER_COMMAND_SOURCE,
	command: "activate",
};

/**
 * BrowserOS is the preferred engine for ordinary browsing, but it cannot host
 * the co-agent. Activation used to open or reuse a BrowserOS page and then
 * fail on it with "The co-agent needs the bundled Chromium renderer." — on a
 * machine where Chromium was ready the whole time.
 */
describe("co-agent activation in the managed browser", () => {
	it("opens its page on the engine that can host it", async () => {
		const browseros = fakeEngine("browseros", false);
		const chromium = fakeEngine("chromium", true);
		const automation = automationWith({
			browseros: browseros.backend,
			chromium: chromium.backend,
		});

		const result = await automation.handle(activate);

		expect(result).toMatchObject({ success: true, session: { tabId: 1 } });
		expect(browseros.calls).toEqual([]);
		expect(chromium.calls).toEqual(["open about:blank", "attach about:blank"]);
	});

	it("moves a page the agent opened in BrowserOS instead of failing on it", async () => {
		const browseros = fakeEngine("browseros", false);
		const chromium = fakeEngine("chromium", true);
		const automation = automationWith({
			browseros: browseros.backend,
			chromium: chromium.backend,
		});
		await automation.handle(webOpen("https://example.test/"));

		const result = await automation.handle(activate);

		expect(result).toMatchObject({
			success: true,
			session: { tabId: 1, url: "https://example.test/" },
		});
		expect(browseros.calls).toEqual([
			"open https://example.test/",
			"close https://example.test/",
		]);
		expect(chromium.calls).toEqual([
			"open https://example.test/",
			"attach https://example.test/",
		]);
		// The agent's tab keeps its id, so its later web commands follow it.
		const status = await automation.status();
		expect(status.sessions).toEqual([
			expect.objectContaining({ tabId: 1, engine: "chromium" }),
		]);
	});

	it("still says so when no engine can host it", async () => {
		const automation = automationWith({
			browseros: fakeEngine("browseros", false).backend,
			chromium: fakeEngine("chromium", false).backend,
		});

		expect(await automation.handle(activate)).toMatchObject({
			success: false,
			error: "The co-agent needs the bundled Chromium renderer.",
		});
	});
});
