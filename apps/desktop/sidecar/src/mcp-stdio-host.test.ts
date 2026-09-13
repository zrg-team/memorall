import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpStdioHost } from "./mcp-stdio-host";
import type { StdioSpec } from "./mcp-stdio-spec";

const fixture = fileURLToPath(
	new URL(
		"../../../../packages/agent-harness/node/src/__tests__/fixtures/stdio-mcp-server.mjs",
		import.meta.url,
	),
);

const spec = (overrides: Partial<StdioSpec> = {}): StdioSpec => ({
	id: "conn-1",
	command: process.execPath,
	args: [fixture],
	env: {},
	secretEnvKeys: [],
	...overrides,
});

const createHost = (resolveCommand?: (command: string) => string | null) =>
	new McpStdioHost({
		searchPath: async () => process.env.PATH ?? "",
		...(resolveCommand ? { resolveCommand } : {}),
	});

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};

describe("McpStdioHost", () => {
	let host: McpStdioHost | undefined;
	afterEach(async () => {
		await host?.stopAll();
		host = undefined;
	});

	it("starts a server, lists its raw tools and calls one", async () => {
		host = createHost();
		const status = await host.ensure(spec());
		expect(status).toMatchObject({ id: "conn-1", state: "running" });
		expect(status.pid).toEqual(expect.any(Number));

		const tools = await host.listTools(spec());
		expect(tools.map((tool) => tool.name)).toEqual(["echo", "env"]);

		expect(await host.call(spec(), "echo", { text: "hi" })).toMatchObject({
			content: [{ type: "text", text: "hi" }],
		});
	});

	it("reuses the process for an unchanged spec and restarts it when the spec changes", async () => {
		host = createHost();
		const first = await host.ensure(spec());
		const again = await host.ensure(spec());
		expect(again.pid).toBe(first.pid);

		const changed = await host.ensure(spec({ args: [fixture, "--changed"] }));
		expect(changed.pid).not.toBe(first.pid);
		await waitFor(() => !isAlive(first.pid as number));
	});

	it("spawns once when requests race for the same server", async () => {
		host = createHost();
		const [a, b] = await Promise.all([
			host.ensure(spec()),
			host.ensure(spec()),
		]);
		expect(a.pid).toBe(b.pid);
	});

	it("starts a stopped server again on the next request", async () => {
		host = createHost();
		const first = await host.ensure(spec());
		expect((await host.stop("conn-1"))?.state).toBe("stopped");
		await waitFor(() => !isAlive(first.pid as number));

		const result = await host.call(spec(), "echo", { text: "back" });
		expect(result.content).toEqual([{ type: "text", text: "back" }]);
	});

	it("passes env to the server and keeps secret values out of its log", async () => {
		const current = createHost();
		host = current;
		const secretSpec = spec({
			env: { API_TOKEN: "super-secret-token" },
			secretEnvKeys: ["API_TOKEN"],
		});
		const result = await current.call(secretSpec, "env", { name: "API_TOKEN" });
		expect(result.content).toEqual([
			{ type: "text", text: "super-secret-token" },
		]);

		await current.call(secretSpec, "echo", { text: "super-secret-token" });
		const logText = () =>
			current.status(["conn-1"])[0]?.logTail.join("\n") ?? "";
		await waitFor(() => logText().includes("echo called"));
		expect(logText()).toContain("echo called with ••••");
		expect(logText()).not.toContain("super-secret-token");
	});

	it("does not leak the sidecar's own environment into the server", async () => {
		process.env.MEMORALL_TEST_LEAK = "leaked";
		try {
			host = createHost();
			const result = await host.call(spec(), "env", {
				name: "MEMORALL_TEST_LEAK",
			});
			expect(result.content).toEqual([{ type: "text", text: "<unset>" }]);
		} finally {
			delete process.env.MEMORALL_TEST_LEAK;
		}
	});

	it("reports a command that is not installed without spawning", async () => {
		host = createHost(() => null);
		await expect(host.ensure(spec({ command: "npx" }))).rejects.toMatchObject({
			code: "MCP_STDIO_COMMAND_NOT_FOUND",
		});
		expect(host.status(["conn-1"])[0]).toMatchObject({
			state: "error",
			lastError: expect.stringContaining("npx"),
		});
	});

	it("marks a crashed server exited and holds it after repeated crashes", async () => {
		const current = createHost();
		host = current;
		const crashing = spec({ args: [fixture, "--crash-after-init"] });

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await expect(
				current.call(crashing, "echo", { text: "boom" }),
			).rejects.toBeTruthy();
			await waitFor(() => current.status(["conn-1"])[0]?.state === "exited");
		}

		await expect(current.ensure(crashing)).rejects.toMatchObject({
			code: "MCP_STDIO_CRASH_LOOP",
		});
		expect((await current.ensure(crashing, { force: true })).state).toBe(
			"running",
		);
	});

	it("stops every server", async () => {
		host = createHost();
		const a = await host.ensure(spec({ id: "a" }));
		const b = await host.ensure(spec({ id: "b" }));
		await host.stopAll();
		expect(host.pids()).toEqual([]);
		await waitFor(() => !isAlive(a.pid as number) && !isAlive(b.pid as number));
	});
});
