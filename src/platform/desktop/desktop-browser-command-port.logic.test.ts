import { describe, expect, it, vi } from "vitest";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { DesktopBrowserCommandPort } from "./desktop-browser-command-port";

const readyStatus = {
	ready: true,
	readiness: "ready" as const,
	engine: "browseros" as const,
	engineVersion: "0.0.37",
	rendererVersion: "148.0.7985.97",
	engines: [
		{
			engine: "browseros" as const,
			readiness: "ready" as const,
			version: "0.0.37",
		},
	],
	persistProfile: false,
	visible: false,
	activeSessions: 0,
	sessions: [],
};

describe("DesktopBrowserCommandPort", () => {
	it("initializes settings and transitions browser capability to ready", async () => {
		const invoke = vi.fn(async () => readyStatus);
		const capabilities = new MutableCapabilityRegistry();
		const port = new DesktopBrowserCommandPort(
			capabilities,
			new InMemoryKeyValueStore(),
			invoke,
		);

		await port.initialize();

		expect(invoke).toHaveBeenCalledWith("desktop_browser_configure", {
			persistProfile: false,
			visible: false,
		});
		expect(capabilities.get("browser.automation").available).toBe(true);
		expect(port.getSnapshot().readiness).toBe("ready");
	});

	it("forwards existing browser requests through the narrow Tauri command", async () => {
		const response = { success: true, command: "close" };
		const invoke = vi.fn(async (command: string) =>
			command === "desktop_browser_configure" ? readyStatus : response,
		);
		const port = new DesktopBrowserCommandPort(
			new MutableCapabilityRegistry(),
			new InMemoryKeyValueStore(),
			invoke,
		);
		const request = { command: "close", sessionId: "session-1" };

		await expect(port.request(request)).resolves.toBe(response);
		expect(invoke).toHaveBeenCalledWith("desktop_browser_request", { request });
	});

	it("maps structured native failures into actionable capability state", async () => {
		const invoke = vi.fn(async () => {
			throw {
				code: "BROWSER_RESOURCES_MISSING",
				message: "Bundled Chromium directory is missing.",
			};
		});
		const capabilities = new MutableCapabilityRegistry();
		const port = new DesktopBrowserCommandPort(
			capabilities,
			new InMemoryKeyValueStore(),
			invoke,
		);

		await port.initialize();

		expect(port.getSnapshot()).toMatchObject({
			readiness: "unavailable",
			failure: { code: "BROWSER_RESOURCES_MISSING" },
		});
		expect(capabilities.get("browser.automation").reason).toContain(
			"BROWSER_RESOURCES_MISSING",
		);
	});

	it("supports explicit user takeover and resume through narrow commands", async () => {
		const takeoverStatus = {
			...readyStatus,
			readiness: "needs-user" as const,
			sessions: [
				{
					tabId: 7,
					engine: "browseros" as const,
					url: "https://example.com/",
					paused: true,
				},
			],
		};
		const invoke = vi.fn(async (command: string) =>
			command === "desktop_browser_takeover" ? takeoverStatus : readyStatus,
		);
		const port = new DesktopBrowserCommandPort(
			new MutableCapabilityRegistry(),
			new InMemoryKeyValueStore(),
			invoke,
		);

		await port.initialize();
		await expect(port.takeover(7)).resolves.toMatchObject({
			readiness: "needs-user",
		});
		await expect(port.resume(7)).resolves.toMatchObject({ readiness: "ready" });
		expect(invoke).toHaveBeenCalledWith("desktop_browser_takeover", {
			tabId: 7,
		});
		expect(invoke).toHaveBeenCalledWith("desktop_browser_resume", { tabId: 7 });
	});
});
