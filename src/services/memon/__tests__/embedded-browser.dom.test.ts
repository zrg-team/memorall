import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import {
	createMemonEmbeddedPort,
	serveEmbeddedPage,
} from "../embedded-browser";
import {
	isLocalAddress,
	sandboxServerUrl,
	sandboxTargetOf,
} from "../embedded-frame";

const sandbox = () => ({
	getServerRenderUrl: vi.fn(async () => ({ url: "about:blank" })),
	handleSwRequestWithRetry: vi.fn(),
	listServers: vi.fn(async () => ({
		servers: [{ port: 5173 }, { port: 3000 }],
	})),
});

const hostOutline: WebPageOutline = {
	url: "http://localhost:3000/",
	title: "Todo app",
	docToken: "doc-1",
	blocks: [{ kind: "heading", level: 1, text: "Todos" }],
	omittedAbove: 0,
	omittedBelow: 0,
	scroll: { y: 0, viewportHeight: 800, pageHeight: 800 },
};

/** BroadcastChannel delivers on a later task. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("embedded page addresses", () => {
	it("maps local addresses and the sandbox's own urls to servers", () => {
		expect(isLocalAddress("localhost:3000/todos")).toBe(true);
		expect(isLocalAddress("example.com")).toBe(false);
		expect(sandboxTargetOf("http://localhost:3000/todos?x=1")).toEqual({
			port: 3000,
			path: "/todos?x=1",
		});
		expect(sandboxTargetOf("127.0.0.1:8080")).toEqual({
			port: 8080,
			path: "/",
		});
		expect(
			sandboxTargetOf(
				"chrome-extension://abc/sandbox/pages/renderer.html?port=3000&path=%2Fabout",
			),
		).toEqual({ port: 3000, path: "/about" });
		expect(
			sandboxTargetOf("chrome-extension://abc/__virtual__/3000/a.css"),
		).toEqual({ port: 3000, path: "/a.css" });
		expect(sandboxTargetOf("https://example.com/")).toBeNull();
		expect(sandboxTargetOf("http://localhost/")).toBeNull();
		expect(sandboxServerUrl({ port: 3000, path: "about" })).toBe(
			"http://localhost:3000/about",
		);
	});
});

describe("embedded browser port", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("opens only servers of the computer, in a hidden frame of its own", async () => {
		const port = createMemonEmbeddedPort(async () => sandbox(), {
			readyTimeoutMs: 5,
		});
		await expect(port.open("https://example.com/", {})).rejects.toThrow(
			"https://example.com/ is not a server in this computer.",
		);
		const opened = await port.open("http://localhost:3000/", {});
		expect(opened.url).toBe("http://localhost:3000/");
		expect(document.querySelectorAll("iframe")).toHaveLength(1);
		expect(await port.servers()).toEqual([3000, 5173]);
		await port.close(opened.sessionId);
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
	});

	it("reads and drives the page the Computer window shows while it shows it", async () => {
		const port = createMemonEmbeddedPort(async () => sandbox(), {
			readyTimeoutMs: 5,
		});
		const { sessionId } = await port.open("http://localhost:3000/", {});
		const host = {
			outline: vi.fn(() => hostOutline),
			act: vi.fn(async () => ({
				result: { ok: true as const, action: "click" as const, ref: "b1" },
				outline: hostOutline,
			})),
			navigate: vi.fn(async () => undefined),
			history: vi.fn(async () => undefined),
		};
		const release = serveEmbeddedPage(sessionId, host);
		await settle();
		// The window's frame is the page now; the hidden one is gone.
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
		expect(await port.outline(sessionId)).toEqual(hostOutline);
		await port.act(sessionId, { ref: "b1", action: "click" });
		expect(host.act).toHaveBeenCalledWith({ ref: "b1", action: "click" });
		await port.navigate(sessionId, "http://localhost:3000/done");
		expect(host.navigate).toHaveBeenCalledWith("http://localhost:3000/done");

		release();
		await settle();
		// Without the window, the computer loads the page itself again.
		const outline = await port.outline(sessionId);
		expect(host.outline).toHaveBeenCalledTimes(1);
		expect(outline.blocks).toEqual([]);
		expect(document.querySelectorAll("iframe")).toHaveLength(1);
	});
});
