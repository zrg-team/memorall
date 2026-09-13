import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IFlowMcpStdioService } from "../interfaces/services/mcp-stdio.js";
import type { MCPServerConfig } from "../steps/features/mcp-feature/types.js";

/**
 * Local servers run in a host process the step cannot reach on its own, so their
 * tools come from the `mcpStdio` service while network servers keep using the
 * shared HTTP client. Both kinds end up in one prefixed, sorted tool list.
 */

const httpDiscover = vi.fn();
const httpCall = vi.fn();

vi.mock("@memorall/agent-harness-mcp", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@memorall/agent-harness-mcp")>();
	return {
		...actual,
		McpClientManager: class {
			discover = httpDiscover;
			call = httpCall;
			close = vi.fn(async () => undefined);
		},
	};
});

const descriptor = (serverId: string, name: string) => ({
	serverId,
	name,
	exposedName: `${serverId}__${name}`,
	description: `${name} from ${serverId}`,
	inputSchema: { type: "object", properties: {} },
});

const HTTP_SERVER: MCPServerConfig = {
	name: "remote",
	type: "http",
	url: "https://example.test/mcp",
};
const STDIO_SERVER: MCPServerConfig = {
	name: "files",
	type: "stdio",
	id: "conn-files",
	command: "npx",
	args: ["-y", "@modelcontextprotocol/server-filesystem", "/work"],
};

type RunnableTool = {
	name: string;
	execute: (
		input: Record<string, unknown>,
		context?: unknown,
	) => Promise<unknown>;
};

const runFeature = async (
	servers: MCPServerConfig[],
	mcpStdio?: IFlowMcpStdioService,
) => {
	const { stepRegistry } = await import("../registries/step-registry.js");
	await import("../steps/features/mcp-feature/mcp-feature.js");
	const step = stepRegistry
		.get("mcp-feature")
		?.factory?.((mcpStdio ? { mcpStdio } : undefined) as never, { servers });
	if (!step) throw new Error("mcp-feature step is not registered");
	const result = await (
		step as {
			execute: (input: {
				messages: unknown[];
				tools: unknown[];
			}) => Promise<{ output?: { tools?: RunnableTool[] } }>;
		}
	).execute({ messages: [{ role: "user", content: "hi" }], tools: [] });
	return result.output?.tools ?? [];
};

const stdioService = () => ({
	listTools: vi.fn(async (server: { name: string }) => [
		descriptor(server.name, "read_file"),
	]),
	call: vi.fn(async () => ({ content: [{ type: "text", text: "from disk" }] })),
});

describe("mcp-feature with local servers", () => {
	beforeEach(() => {
		vi.resetModules();
		httpDiscover.mockReset();
		httpCall.mockReset();
	});

	it("lists tools from network and local servers together", async () => {
		httpDiscover.mockResolvedValueOnce([descriptor("remote", "search")]);
		const mcpStdio = stdioService();

		const tools = await runFeature([HTTP_SERVER, STDIO_SERVER], mcpStdio);

		expect(tools.map((tool) => tool.name)).toEqual([
			"files__read_file",
			"remote__search",
		]);
		expect(mcpStdio.listTools).toHaveBeenCalledWith(STDIO_SERVER);
		expect(httpDiscover).toHaveBeenCalledWith(["remote"]);
	});

	it("sends each call to the side that runs its server", async () => {
		httpDiscover.mockResolvedValueOnce([descriptor("remote", "search")]);
		httpCall.mockResolvedValue({ content: [{ type: "text", text: "remote" }] });
		const mcpStdio = stdioService();
		const tools = await runFeature([HTTP_SERVER, STDIO_SERVER], mcpStdio);

		const readFile = tools.find((tool) => tool.name === "files__read_file");
		const search = tools.find((tool) => tool.name === "remote__search");
		await readFile?.execute({ path: "a.txt" });
		await search?.execute({ query: "x" });

		expect(mcpStdio.call).toHaveBeenCalledTimes(1);
		expect(mcpStdio.call.mock.calls[0]?.slice(0, 3)).toEqual([
			STDIO_SERVER,
			"read_file",
			{ path: "a.txt" },
		]);
		expect(httpCall).toHaveBeenCalledTimes(1);
		expect(httpCall.mock.calls[0]?.slice(0, 3)).toEqual([
			"remote",
			"search",
			{ query: "x" },
		]);
	});

	it("passes the run's abort signal to a local server call", async () => {
		const mcpStdio = stdioService();
		const tools = await runFeature([STDIO_SERVER], mcpStdio);
		const controller = new AbortController();

		await tools[0]?.execute(
			{ path: "a.txt" },
			{ state: {}, signal: controller.signal },
		);

		expect(mcpStdio.call.mock.calls[0]?.[3]).toEqual({
			signal: controller.signal,
		});
	});

	it("skips a local server where the host cannot start processes", async () => {
		httpDiscover.mockResolvedValueOnce([descriptor("remote", "search")]);

		const tools = await runFeature([HTTP_SERVER, STDIO_SERVER]);

		expect(tools.map((tool) => tool.name)).toEqual(["remote__search"]);
	});

	it("keeps a local server's last known tools when it fails to start", async () => {
		vi.useFakeTimers();
		try {
			const mcpStdio = stdioService();
			expect(
				(await runFeature([STDIO_SERVER], mcpStdio)).map((tool) => tool.name),
			).toEqual(["files__read_file"]);

			await vi.advanceTimersByTimeAsync(6 * 60_000);
			mcpStdio.listTools.mockRejectedValueOnce(new Error("exited"));

			// A fresh session on the same module state: the cached prefix survives.
			const { stepRegistry } = await import("../registries/step-registry.js");
			const step = stepRegistry
				.get("mcp-feature")
				?.factory?.({ mcpStdio } as never, { servers: [STDIO_SERVER] });
			const result = await (
				step as {
					execute: (input: {
						messages: unknown[];
						tools: unknown[];
					}) => Promise<{ output?: { tools?: RunnableTool[] } }>;
				}
			).execute({ messages: [], tools: [] });
			expect(result.output?.tools?.map((tool) => tool.name)).toEqual([
				"files__read_file",
			]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens a new session when a local server's arguments change", async () => {
		const mcpStdio = stdioService();
		await runFeature([STDIO_SERVER], mcpStdio);
		const { stepRegistry } = await import("../registries/step-registry.js");
		const changed = { ...STDIO_SERVER, args: ["-y", "other-server"] };
		const step = stepRegistry
			.get("mcp-feature")
			?.factory?.({ mcpStdio } as never, { servers: [changed] });
		await (
			step as {
				execute: (input: {
					messages: unknown[];
					tools: unknown[];
				}) => Promise<unknown>;
			}
		).execute({ messages: [], tools: [] });

		expect(mcpStdio.listTools).toHaveBeenCalledTimes(2);
		expect(mcpStdio.listTools).toHaveBeenLastCalledWith(changed);
	});
});
