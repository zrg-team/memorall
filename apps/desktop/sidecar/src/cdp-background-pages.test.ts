import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CdpConnection,
	ChromiumCdpBackend,
	initializeBackgroundWindow,
} from "./chromium-cdp-backend";
import type { ManagedBrowserOsRuntime } from "./managed-browseros-runtime";

const installCdp = (missingTarget = false) => {
	const browser = {
		send: vi.fn(async (method: string) =>
			method === "Target.createTarget" ? { targetId: "page-1" } : {},
		),
		close: vi.fn(),
	};
	const page = {
		send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
			if (method === "Runtime.evaluate")
				return {
					result: {
						value:
							params?.expression === "document.readyState"
								? "complete"
								: {
										url: "https://example.test/",
										title: "Article",
										html: "<p>Article</p>",
										text: "Article",
										domAccessible: true,
									},
					},
				};
			return {};
		}),
		close: vi.fn(),
	};
	vi.spyOn(CdpConnection, "connect").mockImplementation(
		async (url) =>
			(url.endsWith("/browser") ? browser : page) as unknown as CdpConnection,
	);
	const fetch = vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/json/version"))
			return new Response(
				JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1/browser" }),
			);
		if (url.endsWith("/json/list"))
			return new Response(
				JSON.stringify(
					missingTarget
						? []
						: [{ id: "page-1", webSocketDebuggerUrl: "ws://127.0.0.1/page-1" }],
				),
			);
		throw new Error(`Unexpected request: ${url}`);
	});
	vi.stubGlobal("fetch", fetch);
	const runtime = {
		ensure: async () => ({ cdpEndpoint: "http://127.0.0.1:9222" }),
	} as unknown as ManagedBrowserOsRuntime;
	return { browser, page, fetch, backend: new ChromiumCdpBackend(runtime) };
};

describe("managed Chromium without focus changes", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("starts a visible runtime with a minimized background window", async () => {
		const { browser } = installCdp();
		await initializeBackgroundWindow("http://127.0.0.1:9222");
		expect(browser.send).toHaveBeenCalledExactlyOnceWith(
			"Target.createTarget",
			{
				url: "about:blank",
				newWindow: true,
				background: true,
				windowState: "minimized",
			},
		);
		expect(browser.close).toHaveBeenCalledOnce();
	});

	it("creates fallback tabs in the background and only focuses an explicit show", async () => {
		const { backend, browser, page, fetch } = installCdp();
		const { session } = await backend.open(
			"https://example.test/",
			"window",
			1_000,
			10_000,
		);

		expect(browser.send).toHaveBeenCalledWith(
			"Target.createTarget",
			{ url: "about:blank", background: true },
			undefined,
		);
		expect(
			page.send.mock.calls.some(([method]) => method === "Page.bringToFront"),
		).toBe(false);
		expect(
			fetch.mock.calls.some(([url]) => String(url).includes("/json/new")),
		).toBe(false);

		await backend.show(session);
		expect(page.send).toHaveBeenCalledWith("Page.bringToFront", {}, undefined);
	});

	it("cleans up failed targets without trying a foreground open", async () => {
		const { backend, browser, fetch } = installCdp(true);
		await expect(
			backend.open("about:blank", "tab", 1_000, 1_000),
		).rejects.toThrow("no page target");
		expect(browser.send).toHaveBeenCalledWith("Target.closeTarget", {
			targetId: "page-1",
		});
		expect(
			fetch.mock.calls.some(([url]) => String(url).includes("/json/new")),
		).toBe(false);
	});
});
