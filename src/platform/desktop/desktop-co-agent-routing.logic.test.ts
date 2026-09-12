import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserCommandPort } from "./desktop-browser-command-port";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { CO_AGENT_BROWSER_COMMAND_SOURCE } from "@/co-agent/protocol";

/**
 * Desktop used to have two co-agent surfaces behind this port: one driving a
 * page in the managed browser, and one driving Memorall's own window in-process.
 * The second is gone. It never behaved like the extension — turning the
 * co-agent on pointed it at Memorall's own UI rather than at a web page — and
 * having two answers to "what is the co-agent attached to" was the source of
 * that confusion.
 *
 * So the property to hold now is simply that every co-agent command leaves for
 * the sidecar. Anything served locally would be the old surface growing back.
 */

type Invoke = (
	command: string,
	payload?: Record<string, unknown>,
) => Promise<unknown>;

const build = (invoke: Invoke) =>
	new DesktopBrowserCommandPort(
		new MutableCapabilityRegistry({} as never),
		new InMemoryKeyValueStore(),
		invoke,
	);

const okStatus = {
	ready: true,
	readiness: "ready",
	engine: "chromium",
	engineVersion: null,
	rendererVersion: null,
	engines: [],
	persistProfile: false,
	visible: false,
	activeSessions: 0,
	sessions: [],
};

const routed = (result: unknown = { success: true }) =>
	vi.fn(async (command: string) =>
		command === "desktop_browser_request" ? result : okStatus,
	);

describe("desktop co-agent routing", () => {
	it("sends activation with no URL to the managed browser", async () => {
		// This is the case that used to stay in-process. With no URL the
		// co-agent now attaches to a page in the managed browser, the same way
		// the extension attaches to a tab.
		const invoke = routed({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			success: true,
		});
		const port = build(invoke);

		await port.request({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "activate",
		});

		expect(invoke).toHaveBeenCalledWith(
			"desktop_browser_request",
			expect.anything(),
		);
	});

	it("sends activation with a URL to the managed browser", async () => {
		const invoke = routed({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			success: true,
		});
		const port = build(invoke);

		await port.request({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "activate",
			url: "https://example.test",
		});

		expect(invoke).toHaveBeenCalledWith(
			"desktop_browser_request",
			expect.anything(),
		);
	});

	it("sends content commands to the managed browser", async () => {
		const invoke = routed({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			success: true,
		});
		const port = build(invoke);

		await port.request({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "content-command",
			request: {
				source: "memorall:co-agent-content-command",
				type: "co-agent:observe",
			},
		});

		expect(invoke).toHaveBeenCalledWith(
			"desktop_browser_request",
			expect.anything(),
		);
	});

	it("leaves ordinary web-browser commands alone", async () => {
		const invoke = routed();
		const port = build(invoke);

		await port.request({
			source: "memorall:web-browser-command",
			command: "snapshot",
			sessionId: "s1",
		});

		expect(invoke).toHaveBeenCalledWith(
			"desktop_browser_request",
			expect.anything(),
		);
	});

	it("surfaces a sidecar failure rather than falling back to some other surface", async () => {
		// There is no second surface to fall back to any more, so an error from
		// the browser has to reach the caller intact.
		const invoke = routed({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "activate",
			success: false,
			error: "CO_AGENT_REQUIRES_VISIBLE_BROWSER: ...",
		});
		const port = build(invoke);

		const response = (await port.request({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "activate",
		})) as { success: boolean; error?: string };

		expect(response.success).toBe(false);
		expect(response.error).toContain("CO_AGENT_REQUIRES_VISIBLE_BROWSER");
	});

	/**
	 * The co-agent is meant to be watched, so the sidecar refuses to attach to a
	 * headless browser — and the browser starts headless. Clicking the button was
	 * therefore refused every single time, silently. Activation now makes the
	 * browser visible first.
	 */
	describe("showing the browser for the co-agent", () => {
		const statusWith = (visible: boolean) => ({ ...okStatus, visible });

		it("turns the managed browser visible before attaching", async () => {
			const calls: Array<{ command: string; payload?: unknown }> = [];
			const invoke = vi.fn(async (command: string, payload?: unknown) => {
				calls.push({ command, payload });
				// A real sidecar applies what it was asked for — including the
				// startup configure, which asks for headless.
				if (command === "desktop_browser_configure") {
					return statusWith(
						(payload as { visible?: boolean })?.visible === true,
					);
				}
				if (command === "desktop_browser_request") {
					return { source: CO_AGENT_BROWSER_COMMAND_SOURCE, success: true };
				}
				return statusWith(false);
			});
			const port = build(invoke);

			await port.request({
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "activate",
			});

			const configure = calls.findIndex(
				(call) =>
					call.command === "desktop_browser_configure" &&
					(call.payload as { visible?: boolean })?.visible === true,
			);
			const activate = calls.findIndex(
				(call) => call.command === "desktop_browser_request",
			);
			expect(configure).toBeGreaterThanOrEqual(0);
			// Order matters: attaching first is exactly what got refused.
			expect(configure).toBeLessThan(activate);
		});

		it("keeps the user's profile setting when it shows the browser", async () => {
			const configured: unknown[] = [];
			const invoke = vi.fn(async (command: string, payload?: unknown) => {
				if (command === "desktop_browser_configure") {
					configured.push(payload);
					const requested = payload as {
						visible?: boolean;
						persistProfile?: boolean;
					};
					return {
						...okStatus,
						visible: requested?.visible === true,
						persistProfile: requested?.persistProfile === true,
					};
				}
				if (command === "desktop_browser_request") {
					return { source: CO_AGENT_BROWSER_COMMAND_SOURCE, success: true };
				}
				return { ...okStatus, visible: false, persistProfile: true };
			});
			const store = new InMemoryKeyValueStore();
			await store.set("desktop.browser.persistProfile.v1", true);
			const port = new DesktopBrowserCommandPort(
				new MutableCapabilityRegistry({} as never),
				store,
				invoke,
			);

			await port.request({
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "activate",
			});

			expect(configured.at(-1)).toMatchObject({
				visible: true,
				persistProfile: true,
			});
		});

		it("does not restart a browser that is already visible", async () => {
			// Turning visibility on restarts Chromium and ends its sessions, so it
			// must only happen when it is actually needed.
			const invoke = vi.fn(async (command: string) => {
				if (command === "desktop_browser_request") {
					return { source: CO_AGENT_BROWSER_COMMAND_SOURCE, success: true };
				}
				return statusWith(true);
			});
			const store = new InMemoryKeyValueStore();
			await store.set("desktop.browser.visible.v1", true);
			const port = new DesktopBrowserCommandPort(
				new MutableCapabilityRegistry({} as never),
				store,
				invoke,
			);
			await port.initialize();
			const configuresBefore = invoke.mock.calls.filter(
				([command]) => command === "desktop_browser_configure",
			).length;

			await port.request({
				source: CO_AGENT_BROWSER_COMMAND_SOURCE,
				command: "activate",
			});

			const configuresAfter = invoke.mock.calls.filter(
				([command]) => command === "desktop_browser_configure",
			).length;
			expect(configuresAfter).toBe(configuresBefore);
		});

		it("does not touch visibility for ordinary browser commands", async () => {
			const invoke = routed();
			const port = build(invoke);

			await port.request({
				source: "memorall:web-browser-command",
				command: "snapshot",
				sessionId: "s1",
			});

			// Only the startup configure runs, and it asks for headless — nothing
			// here should have switched the browser visible.
			const configures = (
				invoke.mock.calls as unknown as Array<[string, unknown?]>
			).filter(([command]) => command === "desktop_browser_configure");
			expect(
				configures.some(
					([, payload]) => (payload as { visible?: boolean })?.visible === true,
				),
			).toBe(false);
		});
	});
});
