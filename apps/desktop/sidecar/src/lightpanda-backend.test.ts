import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendOpenError } from "./browser-backend";

/** How the fake Lightpanda answers: its handshake and page load times. */
const lightpanda = vi.hoisted(() => ({
	handshakeMs: 0,
	loadMs: 0,
	calls: [] as string[],
}));

const wait = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		// As fetch does: a cancelled request fails at once.
		if (signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});

vi.mock("./managed-lightpanda-runtime", () => ({
	ManagedLightpandaRuntime: class {
		ensure = async () => "http://127.0.0.1:9/mcp";
	},
}));

vi.mock("./mcp-client", () => ({
	McpClientError: class McpClientError extends Error {},
	StreamableHttpMcpClient: class {
		async initialize(signal?: AbortSignal) {
			lightpanda.calls.push("initialize");
			await wait(lightpanda.handshakeMs, signal);
		}
		async callTool(name: string, _args: unknown, signal?: AbortSignal) {
			lightpanda.calls.push(name);
			if (name === "goto") await wait(lightpanda.loadMs, signal);
			return {
				structuredContent: {
					value: {
						url: "http://fixture/slow",
						title: "",
						html: "",
						text: "late content",
						domAccessible: true,
					},
				},
			};
		}
		async close() {}
	},
}));

const { LightpandaBackend } = await import("./lightpanda-backend");

describe("LightpandaBackend.open", () => {
	beforeEach(() => {
		lightpanda.calls = [];
		lightpanda.handshakeMs = 0;
		lightpanda.loadMs = 0;
	});

	it("sends the page even when the handshake takes longer than its timeout", async () => {
		lightpanda.handshakeMs = 60;
		const backend = new LightpandaBackend();

		const opened = await backend.open("http://fixture/slow", "tab", 25, 10_000);

		expect(lightpanda.calls).toEqual(["initialize", "goto", "evaluate"]);
		expect(opened.snapshot.text).toBe("late content");
	});

	it("keeps a page that started loading when its load times out", async () => {
		lightpanda.handshakeMs = 60;
		lightpanda.loadMs = 250;
		const backend = new LightpandaBackend();

		const opening = backend.open("http://fixture/slow", "tab", 25, 10_000);

		const error = await opening.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(BackendOpenError);
		expect((error as BackendOpenError).code).toBe("NAVIGATION_TIMEOUT");
		expect((error as BackendOpenError).session).toBeDefined();
		// The navigation was sent: the tab can be read once the page arrives.
		expect(lightpanda.calls).toEqual(["initialize", "goto"]);
	});

	it("keeps no tab when the caller cancels during the handshake", async () => {
		lightpanda.handshakeMs = 200;
		const backend = new LightpandaBackend();
		const cancel = new AbortController();

		const opening = backend.open(
			"http://fixture/slow",
			"tab",
			25,
			10_000,
			cancel.signal,
		);
		cancel.abort();

		const error = await opening.catch((caught: unknown) => caught);
		expect(error).not.toBeInstanceOf(BackendOpenError);
		expect(lightpanda.calls).toEqual(["initialize"]);
	});
});
