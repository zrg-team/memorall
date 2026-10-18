import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserOsBackend, pickScreenshotTarget } from "./browseros-backend";
import type { ManagedBrowserOsRuntime } from "./managed-browseros-runtime";
import { StreamableHttpMcpClient } from "./mcp-client";

const page = (url: string, id = url) => ({
	type: "page",
	url,
	webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
});

describe("BrowserOS background pages", () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([true, false])(
		"opens without activating the tab when visible=%j",
		async (visible) => {
			vi.spyOn(
				StreamableHttpMcpClient.prototype,
				"listTools",
			).mockResolvedValue(
				new Set(["tabs", "navigate", "evaluate", "wait", "screenshot"]),
			);
			const callTool = vi
				.spyOn(StreamableHttpMcpClient.prototype, "callTool")
				.mockImplementation(async (name) => ({
					structuredContent:
						name === "tabs"
							? { page: 7 }
							: {
									value: {
										url: "https://example.test/",
										title: "Article",
										html: "<p>Article</p>",
										text: "Article",
										domAccessible: true,
									},
								},
				}));
			const runtime = {
				ensure: vi.fn(async () => ({ endpoint: "http://127.0.0.1:1234/mcp" })),
			} as unknown as ManagedBrowserOsRuntime;
			const backend = new BrowserOsBackend(runtime, () => ({
				visible,
				persistProfile: true,
			}));

			const result = await backend.open(
				"https://example.test/",
				"window",
				1_000,
				10_000,
			);

			expect(result.session.handle).toBe(7);
			expect(callTool).toHaveBeenCalledWith(
				"tabs",
				{ action: "new", background: true },
				undefined,
			);
			expect(callTool.mock.calls.map(([name]) => name)).toEqual([
				"tabs",
				"navigate",
				"evaluate",
			]);
		},
	);
});

describe("pickScreenshotTarget", () => {
	it("takes the one page showing the session's address", () => {
		const targets = [
			page("https://a.example/"),
			{ type: "service_worker", url: "https://b.example/sw.js" },
			page("https://b.example/"),
		];
		expect(pickScreenshotTarget(targets, "https://b.example/")).toBe(
			targets[2],
		);
	});

	it("never guesses between several pages", () => {
		// The session's page moved on: another tab must not stand in for it.
		const moved = [page("https://a.example/"), page("https://b.example/")];
		expect(pickScreenshotTarget(moved, "https://c.example/")).toBeNull();
		// Two tabs on the same address cannot be told apart.
		const twins = [
			page("https://a.example/", "1"),
			page("https://a.example/", "2"),
		];
		expect(pickScreenshotTarget(twins, "https://a.example/")).toBeNull();
	});

	it("takes the only page there is, wherever it went", () => {
		const targets = [
			page("https://a.example/next"),
			{ type: "page", url: "https://b.example/" },
		];
		expect(pickScreenshotTarget(targets, "https://a.example/")).toBe(
			targets[0],
		);
	});
});
