import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpStdioClientManager, type McpStdioServerConfig } from "../index.js";

const fixture = fileURLToPath(new URL("./fixtures/stdio-mcp-server.mjs", import.meta.url));
const server = (id: string, ...args: string[]): McpStdioServerConfig => ({ id, command: process.execPath, args: [fixture, ...args] });

const isAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("McpStdioClientManager", () => {
  let manager: McpStdioClientManager | undefined;
  afterEach(async () => { await manager?.close(); manager = undefined; });

  it("discovers prefixed tools with normalized schemas and calls them", async () => {
    manager = new McpStdioClientManager([server("fixture")]);
    const tools = await manager.discover();

    expect(tools.map((tool) => tool.exposedName)).toEqual(["fixture__echo", "fixture__env"]);
    expect(tools[0]?.metadata).toMatchObject({ transport: "stdio", originalToolName: "echo" });
    expect(await manager.call("fixture", "echo", { text: "hi" })).toMatchObject({ content: [{ type: "text", text: "hi" }] });
  });

  it("can leave tool names unprefixed", async () => {
    manager = new McpStdioClientManager([server("fixture")], { prefixToolNames: false });
    expect((await manager.discover()).map((tool) => tool.exposedName)).toEqual(["echo", "env"]);
  });

  it("pipes stderr to the listener instead of the host's own streams", async () => {
    const lines: string[] = [];
    manager = new McpStdioClientManager([server("fixture")], { onStderr: (_id, chunk) => lines.push(chunk) });
    await manager.call("fixture", "echo", { text: "logged" });

    await waitFor(() => lines.join("").includes("echo called with logged"));
    expect(lines.join("")).toContain("fixture ready");
  });

  it("spawns once when two callers connect at the same time", async () => {
    manager = new McpStdioClientManager([server("fixture")]);
    const [first, second] = await Promise.all([manager.connect("fixture"), manager.connect("fixture")]);
    expect(first).toBe(second);
  });

  it("stops a single server and ends its process", async () => {
    manager = new McpStdioClientManager([server("a"), server("b")]);
    await Promise.all([manager.connect("a"), manager.connect("b")]);
    const pidA = manager.pid("a");
    expect(pidA).not.toBeNull();

    await manager.close("a");

    expect(manager.pid("a")).toBeNull();
    expect(manager.pid("b")).not.toBeNull();
    await waitFor(() => !isAlive(pidA!));
  });

  it("reports a process that exits on its own", async () => {
    const exits: string[] = [];
    manager = new McpStdioClientManager([server("fixture", "--crash-after-init")], { onExit: (id) => exits.push(id) });
    await manager.connect("fixture");

    await expect(manager.call("fixture", "echo", { text: "boom" })).rejects.toThrow();
    await waitFor(() => exits.length > 0);
    expect(exits).toEqual(["fixture"]);
    expect(manager.pid("fixture")).toBeNull();
  });

  it("does not report an exit it asked for", async () => {
    const exits: string[] = [];
    manager = new McpStdioClientManager([server("fixture")], { onExit: (id) => exits.push(id) });
    await manager.connect("fixture");
    await manager.close("fixture");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exits).toEqual([]);
  });

  it("gives up on a server that does not finish the handshake in time", async () => {
    manager = new McpStdioClientManager([server("slow", "--slow-start", "5000")], { connectTimeoutMs: 300 });
    await expect(manager.connect("slow")).rejects.toThrow(/timed out/i);
    expect(manager.pid("slow")).toBeNull();
  });

  it("cancels a running call on the server when its signal aborts", async () => {
    const lines: string[] = [];
    manager = new McpStdioClientManager([server("fixture")], { onStderr: (_id, chunk) => lines.push(chunk) });
    await manager.connect("fixture");
    const controller = new AbortController();
    const started = Date.now();
    const call = manager.call("fixture", "sleep", { ms: 10_000 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);

    await expect(call).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
    await waitFor(() => lines.join("").includes("sleep cancelled"));
  });

  it("rejects a command that does not exist", async () => {
    // ENOENT elsewhere; on Windows cross-spawn goes through cmd.exe, which exits
    // and closes the connection instead. Hosts resolve the command first.
    manager = new McpStdioClientManager([{ id: "missing", command: "memorall-no-such-command-xyz", stderr: "ignore" }]);
    await expect(manager.connect("missing")).rejects.toThrow();
    expect(manager.pid("missing")).toBeNull();
  });
});
