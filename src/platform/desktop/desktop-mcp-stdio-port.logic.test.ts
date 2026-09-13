import { describe, expect, it, vi } from "vitest";
import { McpStdioPortError } from "../contracts/core";
import { DesktopMcpStdioPort } from "./desktop-mcp-stdio-port";

const spec = {
	id: "conn-1",
	command: "npx",
	args: ["-y", "@modelcontextprotocol/server-memory"],
	env: {},
	secretEnvKeys: [],
};

describe("DesktopMcpStdioPort", () => {
	it("sends every request through the one allowlisted command", async () => {
		const invoke = vi.fn(async () => ({ tools: [{ name: "read_graph" }] }));
		const port = new DesktopMcpStdioPort(invoke);

		await expect(port.listTools(spec)).resolves.toEqual([
			{ name: "read_graph" },
		]);
		expect(invoke).toHaveBeenCalledWith("desktop_mcp_stdio_request", {
			method: "mcp.stdio.list-tools",
			params: { spec },
		});
	});

	it("passes call budgets and unwraps wrapped results", async () => {
		const invoke = vi.fn(
			async (_command: string, args?: Record<string, unknown>) => {
				const method = args?.method;
				if (method === "mcp.stdio.status")
					return { servers: [{ id: "conn-1" }] };
				if (method === "mcp.stdio.stop") return { status: null };
				if (method === "mcp.stdio.probe") {
					return { searchPath: "", runtimes: { npx: { found: true } } };
				}
				return { content: [] };
			},
		);
		const port = new DesktopMcpStdioPort(invoke);

		await port.call(
			spec,
			"create_entities",
			{ entities: [] },
			{ timeoutMs: 30_000 },
		);
		expect(invoke).toHaveBeenLastCalledWith("desktop_mcp_stdio_request", {
			method: "mcp.stdio.call",
			params: {
				spec,
				tool: "create_entities",
				input: { entities: [] },
				timeoutMs: 30_000,
			},
		});
		await expect(port.status(["conn-1"])).resolves.toEqual([{ id: "conn-1" }]);
		await expect(port.stop("conn-1")).resolves.toBeNull();
		await expect(port.probe(["npx"])).resolves.toEqual({
			npx: { found: true },
		});
	});

	it("cancels an aborted call on the sidecar and stops waiting for it", async () => {
		const calls: Array<{ method: unknown; params: Record<string, unknown> }> =
			[];
		const invoke = vi.fn((_command: string, args?: Record<string, unknown>) => {
			calls.push({
				method: args?.method,
				params: args?.params as Record<string, unknown>,
			});
			// The call itself never answers; only the cancel does.
			return args?.method === "mcp.stdio.cancel"
				? Promise.resolve({ cancelled: true })
				: new Promise(() => undefined);
		});
		const port = new DesktopMcpStdioPort(invoke);
		const controller = new AbortController();

		const call = port.call(spec, "slow", {}, { signal: controller.signal });
		controller.abort();

		await expect(call).rejects.toMatchObject({ name: "AbortError" });
		const callId = calls[0]?.params.callId;
		expect(callId).toEqual(expect.any(String));
		expect(calls[1]).toEqual({
			method: "mcp.stdio.cancel",
			params: { callId },
		});
	});

	it("does not start a call whose signal already aborted", async () => {
		const invoke = vi.fn();
		const port = new DesktopMcpStdioPort(invoke);
		const controller = new AbortController();
		controller.abort();

		await expect(
			port.call(spec, "slow", {}, { signal: controller.signal }),
		).rejects.toBeTruthy();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("asks the dialog plugin for a single folder", async () => {
		const invoke = vi.fn(async () => "C:\\projects\\app");
		const port = new DesktopMcpStdioPort(invoke);

		await expect(port.pickDirectory()).resolves.toBe("C:\\projects\\app");
		expect(invoke).toHaveBeenCalledWith("plugin:dialog|open", {
			options: { directory: true, multiple: false },
		});
		invoke.mockResolvedValueOnce(null as never);
		await expect(port.pickDirectory()).resolves.toBeNull();
	});

	it.each([
		[
			{
				code: "MCP_STDIO_COMMAND_NOT_FOUND",
				message: '"uvx" is not installed',
			},
			"MCP_STDIO_COMMAND_NOT_FOUND",
		],
		[
			{ code: "BROWSER_TIMEOUT", message: "browser timed out" },
			"MCP_STDIO_TIMEOUT",
		],
		[
			{
				code: "INVALID_REQUEST",
				message: "Sidecar method is not allowed: mcp.stdio.call",
			},
			"MCP_STDIO_UNSUPPORTED",
		],
		[new Error("boom"), "MCP_STDIO_UNAVAILABLE"],
	])("maps %j to %s", async (failure, code) => {
		const port = new DesktopMcpStdioPort(async () => {
			throw failure;
		});
		const error = await port.ensure(spec).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(McpStdioPortError);
		expect((error as McpStdioPortError).code).toBe(code);
	});
});
