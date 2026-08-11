import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileCheckpointStore, FileEventStore, McpStdioClientManager, NodeFileSystem, NodeLocalSandboxProvider, createNodePlatform } from "../index.js";

const call = (operationId: string) => ({ operationId, deadlineMs: Date.now() + 30_000 });

describe("Node platform adapters", () => {
  it("implements filesystem operations with native Node promises", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harness-fs-test-"));
    const fs = new NodeFileSystem();
    try {
      await fs.mkdir(path.join(root, "dir"), { recursive: true });
      const source = path.join(root, "dir", "a.txt");
      await fs.writeFile(source, "one");
      await fs.appendFile(source, " two");
      expect(await fs.readFile(source, { encoding: "utf8" })).toBe("one two");
      const copy = path.join(root, "copy.txt");
      await fs.copyFile(source, copy);
      const renamed = path.join(root, "renamed.txt");
      await fs.rename(copy, renamed);
      expect((await fs.readdir(root, { withFileTypes: true })).some(({ name, isFile }) => name === "renamed.txt" && isFile())).toBe(true);
      await fs.rm(renamed, { force: true });
      await expect(fs.access(renamed)).rejects.toBeTruthy();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("persists checkpoints and append-only events with opaque cursors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "harness-store-test-"));
    try {
      const checkpoints = new FileCheckpointStore(root);
      const checkpoint = { contractVersion: 1 as const, id: "checkpoint/1", runId: "run", graphId: "graph", graphVersion: "1", pluginVersions: {}, state: { value: 1 }, createdAt: 1 };
      await checkpoints.save(checkpoint);
      expect(await checkpoints.load(checkpoint.id)).toEqual(checkpoint);
      await checkpoints.delete(checkpoint.id);
      expect(await checkpoints.load(checkpoint.id)).toBeUndefined();

      const events = new FileEventStore(root);
      await Promise.all([
        events.append("run", [{ type: "run.started", runId: "run", graphId: "graph", timestamp: 1 }]),
        events.append("run", [{ type: "run.completed", runId: "run", result: "ok", timestamp: 2 }]),
      ]);
      const page = await events.read("run");
      expect(page.events).toHaveLength(2);
      expect((await events.read("run", "1")).events).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("runs the capability-gated local sandbox and preserves cursor continuity", async () => {
    const provider = new NodeLocalSandboxProvider();
    const session = await provider.createSession({ sessionKey: "test" }, call("create"));
    try {
      expect(session.capabilities.supported).toContain("runtime.code");
      expect(session.capabilities.supported).not.toContain("runtime.repl");
      expect(session.capabilities.supported).not.toContain("snapshot.capture");
      await session.workspace.bind({ root: "/", directories: ["/"], files: [{ path: "/main.js", content: "console.log('file-ok')" }], mode: "full" }, call("bind"));
      expect(await session.runtime.run({ operation: "file", path: "/main.js" }, call("file"))).toMatchObject({ status: "ok", result: expect.stringContaining("file-ok") });
      expect(await session.runtime.run({ operation: "code", code: "require('fs').writeFileSync('generated.txt', 'created')" }, call("code"))).toMatchObject({ status: "ok" });
      const flushed = await session.workspace.flush(call("flush"));
      expect(flushed.changes).toContainEqual({ operation: "write", path: "/generated.txt", content: "created" });

      const commandText = `\"${process.execPath}\" -e \"console.log('first');setTimeout(()=>console.log('second'),30)\"`;
      const command = await session.runtime.run({ operation: "command", command: commandText, waitTimeoutMs: 100 }, call("command"));
      if (command.kind !== "command") throw new Error("Expected command result");
      const first = await session.processes.manage({ operation: "read", processId: command.processId, cursor: "0:0", maxChars: 5 }, call("read-1"));
      if (!("events" in first)) throw new Error("Expected process page");
      const pages = [first];
      let cursor = first.nextCursor;
      for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await session.processes.manage({ operation: "read", processId: command.processId, cursor, waitMs: 250, maxChars: 100 }, call(`read-${pageNumber + 2}`));
        if (!("events" in page)) throw new Error("Expected process page");
        pages.push(page);
        cursor = page.nextCursor;
        if (page.status !== "running" && !page.truncated) break;
      }
      const combined = pages.flatMap(({ events }) => events).map(({ text }) => text ?? "").join("");
      expect(combined).toContain("first");
      expect(combined).toContain("second");
      expect(pages.at(-1)?.status).toBe("completed");
      expect(await session.network!.fetch({ url: "data:application/json,%7B%22ok%22%3Atrue%7D" }, call("fetch"))).toMatchObject({ status: 200, responseType: "json" });
    } finally { await session.close(call("close")); }
  });

  it("supplies Node platform primitives and validates stdio server IDs without spawning", () => {
    const platform = createNodePlatform();
    expect(platform.runtime).toBe("node");
    expect(platform.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => new McpStdioClientManager([
      { id: "same", command: "one" },
      { id: "same", command: "two" },
    ])).toThrow(/Duplicate MCP stdio server/);
  });
});
