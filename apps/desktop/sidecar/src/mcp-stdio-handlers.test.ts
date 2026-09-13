import { describe, expect, it, vi } from "vitest";
import { handleMcpStdioRequest, isMcpStdioMethod } from "./mcp-stdio-handlers";
import type { McpStdioHost } from "./mcp-stdio-host";

const spec = { id: "c1", command: "npx", args: ["-y", "pkg"] };

const fakeHost = () => {
	const host = {
		ensure: vi.fn(async () => ({ state: "running" })),
		listTools: vi.fn(async () => [{ name: "echo" }]),
		call: vi.fn(async () => ({ content: [] })),
		stop: vi.fn(async () => null),
		status: vi.fn(() => []),
		probe: vi.fn(async () => ({ searchPath: "", runtimes: {} })),
	};
	return { host, asHost: host as unknown as McpStdioHost };
};

const signal = new AbortController().signal;

describe("handleMcpStdioRequest", () => {
	it("recognises only its own methods", () => {
		expect(isMcpStdioMethod("mcp.stdio.call")).toBe(true);
		expect(isMcpStdioMethod("mcp.stdio.connect")).toBe(false);
		expect(isMcpStdioMethod("browser.command")).toBe(false);
	});

	it("routes a call with its parsed spec, input, timeout and cancel signal", async () => {
		const { host, asHost } = fakeHost();
		await handleMcpStdioRequest(
			asHost,
			"mcp.stdio.call",
			{ spec, tool: "echo", input: { text: "hi" }, timeoutMs: 5_000 },
			signal,
		);
		expect(host.call).toHaveBeenCalledWith(
			expect.objectContaining({ id: "c1", command: "npx", env: {} }),
			"echo",
			{ text: "hi" },
			{ signal, timeoutMs: 5_000 },
		);
	});

	it("wraps tool listings so the response stays an object", async () => {
		const { asHost } = fakeHost();
		expect(
			await handleMcpStdioRequest(
				asHost,
				"mcp.stdio.list-tools",
				{ spec },
				signal,
			),
		).toEqual({ tools: [{ name: "echo" }] });
	});

	it.each([
		["mcp.stdio.ensure", { spec, force: "yes" }, "force"],
		["mcp.stdio.ensure", { spec, extra: 1 }, "unexpected"],
		["mcp.stdio.call", { spec, tool: "" }, "tool"],
		["mcp.stdio.call", { spec, tool: "echo", input: [] }, "input"],
		["mcp.stdio.call", { spec, tool: "echo", timeoutMs: 0 }, "timeoutMs"],
		["mcp.stdio.probe", { commands: [] }, "1 to 16"],
		["mcp.stdio.status", { ids: [1] }, "ids"],
		["mcp.stdio.stop", {}, "id"],
	] as const)("rejects bad %s params %j", async (method, params, message) => {
		await expect(
			handleMcpStdioRequest(fakeHost().asHost, method, params, signal),
		).rejects.toMatchObject({
			code: expect.stringMatching(/^MCP_STDIO_INVALID_/),
			message: expect.stringContaining(message),
		});
	});

	it("cancels a call by the id its caller gave it", async () => {
		const { host, asHost } = fakeHost();
		let seen: AbortSignal | undefined;
		let finish: (() => void) | undefined;
		host.call.mockImplementationOnce(
			async (...args: unknown[]) =>
				new Promise((resolve) => {
					seen = (args[3] as { signal: AbortSignal }).signal;
					finish = () => resolve({ content: [] });
				}),
		);

		const call = handleMcpStdioRequest(
			asHost,
			"mcp.stdio.call",
			{ spec, tool: "sleep", callId: "call-7" },
			signal,
		);
		await Promise.resolve();
		expect(seen?.aborted).toBe(false);

		expect(
			await handleMcpStdioRequest(
				asHost,
				"mcp.stdio.cancel",
				{ callId: "call-7" },
				signal,
			),
		).toEqual({ cancelled: true });
		expect(seen?.aborted).toBe(true);

		finish?.();
		await call;
		// Finished calls are forgotten, so a late cancel is a no-op.
		expect(
			await handleMcpStdioRequest(
				asHost,
				"mcp.stdio.cancel",
				{ callId: "call-7" },
				signal,
			),
		).toEqual({ cancelled: false });
	});

	it("reports a cancelled call as cancelled, not as a failure", async () => {
		const { host, asHost } = fakeHost();
		host.call.mockImplementationOnce(
			async (...args: unknown[]) =>
				new Promise((_, reject) => {
					const { signal: callSignal } = args[3] as { signal: AbortSignal };
					callSignal.addEventListener("abort", () =>
						reject(new Error("This operation was aborted")),
					);
				}),
		);

		const call = handleMcpStdioRequest(
			asHost,
			"mcp.stdio.call",
			{ spec, tool: "sleep", callId: "call-8" },
			signal,
		);
		await Promise.resolve();
		await handleMcpStdioRequest(
			asHost,
			"mcp.stdio.cancel",
			{ callId: "call-8" },
			signal,
		);

		await expect(call).rejects.toMatchObject({ code: "MCP_STDIO_CANCELLED" });
	});

	it("gives failures from a running server their own code", async () => {
		const { host, asHost } = fakeHost();
		host.call.mockRejectedValueOnce(new Error("Request timed out"));
		await expect(
			handleMcpStdioRequest(
				asHost,
				"mcp.stdio.call",
				{ spec, tool: "echo" },
				signal,
			),
		).rejects.toMatchObject({ code: "MCP_STDIO_REQUEST_FAILED" });
	});
});
