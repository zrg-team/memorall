import { describe, expect, it } from "vitest";
import {
  ServiceResolver,
  executeTool,
  parseToolInput,
  RunContext,
} from "@memorall/agent-harness-core";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import type { DirEntry, FileStat, HarnessFileSystem } from "@memorall/agent-harness-standard/filesystem";
import {
  SANDBOX_SERVICE,
  SandboxError,
  SandboxManager,
  SandboxProviderRegistry,
  SandboxWorkspaceCoordinator,
  createSandboxTools,
  getSandboxToolsForProfile,
  sandboxPlugin,
} from "../index.js";
import {
  createFakeRemoteSandboxProvider,
  queueFakeWorkspaceChanges,
} from "../testing.js";

class MemoryFileSystem implements HarnessFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>(["/"]);

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.ensureParents(path);
      this.files.set(path, new TextEncoder().encode(content));
    }
  }

  private ensureParents(path: string): void {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    let parent = "";
    for (const part of parts) {
      parent += `/${part}`;
      this.directories.add(parent);
    }
  }

  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: "utf8" | "utf-8" | "base64" | "hex" | "latin1" }): Promise<string>;
  async readFile(path: string, options?: { encoding: "utf8" | "utf-8" | "base64" | "hex" | "latin1" }): Promise<Uint8Array | string> {
    const value = this.files.get(path);
    if (!value) throw new Error(`ENOENT: ${path}`);
    return options ? new TextDecoder().decode(value) : value.slice();
  }
  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    this.ensureParents(path);
    this.files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
  }
  async appendFile(path: string, data: string | Uint8Array): Promise<void> {
    const previous = this.files.get(path) ?? new Uint8Array();
    const next = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const combined = new Uint8Array(previous.length + next.length);
    combined.set(previous);
    combined.set(next, previous.length);
    await this.writeFile(path, combined);
  }
  async unlink(path: string): Promise<void> { this.files.delete(path); }
  async rename(oldPath: string, newPath: string): Promise<void> {
    const value = this.files.get(oldPath);
    if (!value) throw new Error(`ENOENT: ${oldPath}`);
    this.files.delete(oldPath);
    await this.writeFile(newPath, value);
  }
  async copyFile(src: string, dest: string): Promise<void> { await this.writeFile(dest, await this.readFile(src)); }
  async mkdir(path: string): Promise<string | undefined> { this.ensureParents(`${path}/child`); this.directories.add(path); return path; }
  async rmdir(path: string): Promise<void> { this.directories.delete(path); }
  async rm(path: string): Promise<void> {
    this.files.delete(path);
    for (const key of [...this.files.keys()]) if (key.startsWith(`${path}/`)) this.files.delete(key);
    this.directories.delete(path);
  }
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  async readdir(path: string, options?: { withFileTypes: true }): Promise<string[] | DirEntry[]> {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Map<string, "file" | "directory">();
    for (const directory of this.directories) {
      if (!directory.startsWith(prefix) || directory === path) continue;
      const remainder = directory.slice(prefix.length);
      if (remainder && !remainder.includes("/")) names.set(remainder, "directory");
    }
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const remainder = file.slice(prefix.length);
      if (remainder && !remainder.includes("/")) names.set(remainder, "file");
    }
    if (!options) return [...names.keys()];
    return [...names].map(([name, kind]): DirEntry => ({
      name,
      isFile: () => kind === "file",
      isDirectory: () => kind === "directory",
      isSymbolicLink: () => false,
    }));
  }
  async stat(path: string): Promise<FileStat> {
    const file = this.files.get(path);
    const directory = this.directories.has(path);
    if (!file && !directory) throw new Error(`ENOENT: ${path}`);
    return { isFile: () => Boolean(file), isDirectory: () => directory, isSymbolicLink: () => false, size: file?.length ?? 0, mtime: new Date(0) };
  }
  async access(path: string): Promise<void> { await this.stat(path); }
}

const setup = (options: { close?: boolean; fs?: MemoryFileSystem } = {}) => {
  const platform = createTestPlatform();
  const provider = createFakeRemoteSandboxProvider({ now: platform.now });
  const registry = new SandboxProviderRegistry().register(provider);
  const coordinator = new SandboxWorkspaceCoordinator(options.fs);
  const manager = new SandboxManager(registry, {
    providerId: provider.id,
    sessionPolicy: options.close ? "close-on-release" : "reuse-conversation",
  }, platform, coordinator);
  return { platform, provider, registry, coordinator, manager };
};

describe("sandbox provider contracts", () => {
  it("registers arbitrary providers and rejects duplicates or unknown IDs", () => {
    const provider = createFakeRemoteSandboxProvider({ id: "cloud.example" });
    const registry = new SandboxProviderRegistry().register(provider);
    expect(registry.require("cloud.example")).toBe(provider);
    expect(() => registry.register(provider)).toThrow(/already registered/);
    expect(() => registry.require("missing")).toThrowError(SandboxError);
  });

  it("creates, reuses, reconnects, releases, and closes sessions", async () => {
    const { manager, provider } = setup({ close: true });
    const first = await manager.acquire({ sessionKey: "conversation" });
    const second = await manager.acquire({ sessionKey: "conversation" });
    expect(second.session.sessionId).toBe(first.session.sessionId);
    await manager.release("conversation");
    expect(provider.state.closed).toBe(true);
    const resumed = await manager.acquire({ sessionKey: "resumed", resumeProviderSessionId: "remote:saved" });
    expect(resumed.session.providerSessionId).toBe("remote:saved");
    expect(provider.state.calls.some((entry) => entry.startsWith("session.reconnect:"))).toBe(true);
  });

  it("normalizes cancellation, deadlines, missing providers, and capabilities", async () => {
    const { manager } = setup();
    await expect(manager.acquire({}, { deadlineMs: 0 })).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    controller.abort();
    await expect(manager.acquire({}, { signal: controller.signal })).rejects.toMatchObject({ code: "timeout" });
    const registry = new SandboxProviderRegistry();
    const missing = new SandboxManager(registry, { providerId: "missing" }, createTestPlatform());
    await expect(missing.acquire()).rejects.toMatchObject({ code: "provider_error" });
    const limitedProvider = createFakeRemoteSandboxProvider({ capabilities: {
      supported: ["runtime.code"], packageManagers: [], limits: { maxConcurrentSessions: 1, maxOutputChars: 10, maxLogEntries: 1 },
    } });
    const limited = new SandboxManager(new SandboxProviderRegistry().register(limitedProvider), { providerId: limitedProvider.id }, createTestPlatform());
    await expect(limited.packages({ operation: "list" })).rejects.toMatchObject({ code: "capability_unavailable" });
  });

  it("covers inspect, runtime code, file, command, and REPL operations", async () => {
    const fs = new MemoryFileSystem({ "/main.js": "export default 7" });
    const { manager } = setup({ fs });
    expect(await manager.inspect({ operation: "status" })).toMatchObject({ status: "ready" });
    expect(await manager.run({ operation: "code", code: "1 + 1" })).toMatchObject({ kind: "code", result: "1 + 1" });
    expect(await manager.run({ operation: "file", path: "/main.js" })).toMatchObject({ kind: "file", result: "export default 7" });
    expect(await manager.run({ operation: "repl", code: "const x = 1" })).toMatchObject({ kind: "repl", replId: "repl:default" });
    expect(await manager.run({ operation: "command", command: "dev" })).toMatchObject({ kind: "command", status: "running" });
    expect(await manager.inspect({ operation: "logs" })).toHaveProperty("logs");
    expect(await manager.inspect({ operation: "clear_logs" })).toEqual({ cleared: true });
    expect(await manager.inspect({ operation: "reset" })).toEqual({ reset: true });
  });

  it("uses opaque cursors without duplicate or skipped process output", async () => {
    const { manager } = setup();
    const command = await manager.run({ operation: "command", command: "server" });
    if (command.kind !== "command") throw new Error("Expected command result");
    const first = await manager.process({ operation: "read", processId: command.processId, cursor: "0" });
    expect("events" in first && first.events).toHaveLength(1);
    const cursor = "nextCursor" in first ? first.nextCursor : "";
    await manager.process({ operation: "stdin", processId: command.processId, input: "hello\n" });
    const second = await manager.process({ operation: "read", processId: command.processId, cursor });
    expect("events" in second && second.events.map((event) => event.text)).toEqual(["hello\n"]);
    expect(await manager.process({ operation: "list" })).toHaveProperty("processes");
    expect(await manager.process({ operation: "stop", processId: command.processId })).toEqual({ processId: command.processId, stopped: true });
  });

  it("covers packages, previews, network, and snapshots", async () => {
    const { manager, provider } = setup();
    expect(await manager.packages({ operation: "install", packageSpec: "zod@4" })).toMatchObject({ success: true });
    expect(await manager.packages({ operation: "install_from_package_json" })).toMatchObject({ success: true });
    expect(await manager.packages({ operation: "list" })).toMatchObject({ packages: { "zod@4": "1.0.0" } });

    const preview = await manager.preview({ operation: "start", projectDir: "/app", kind: "vite" });
    if (!("previewId" in preview)) throw new Error("Expected preview");
    expect(await manager.preview({ operation: "list" })).toMatchObject({ previews: [expect.objectContaining({ previewId: preview.previewId })] });
    expect(await manager.preview({ operation: "request", previewId: preview.previewId })).toMatchObject({ status: 200 });
    expect(await manager.preview({ operation: "render", previewId: preview.previewId })).toMatchObject({ body: "<main>ready</main>" });
    expect(await manager.preview({ operation: "stop", previewId: preview.previewId })).toEqual({ previewId: preview.previewId, stopped: true });
    expect(await manager.network({ url: "https://fixture.invalid/data" })).toMatchObject({ status: 200, responseType: "json" });

    provider.state.files.set("/state.txt", "before");
    const snapshot = await manager.snapshot({ operation: "create", label: "stable" });
    provider.state.files.set("/state.txt", "after");
    await manager.snapshot({ operation: "restore", snapshotId: snapshot.snapshotId });
    expect(provider.state.files.get("/state.txt")).toBe("before");
    await expect(manager.snapshot({ operation: "restore", snapshotId: "missing" })).rejects.toMatchObject({ code: "snapshot_not_found" });
  });

  it("synchronizes host changes, flushes provider changes, and reports conflicts", async () => {
    const fs = new MemoryFileSystem({ "/shared.txt": "one" });
    const { manager, provider } = setup({ fs });
    await manager.acquire();
    expect(provider.state.files.get("/shared.txt")).toBe("one");
    await fs.writeFile("/shared.txt", "two");
    await manager.run({ operation: "code", code: "sync" });
    expect(provider.state.files.get("/shared.txt")).toBe("two");

    queueFakeWorkspaceChanges(provider, [{ operation: "write", path: "/generated.txt", content: "generated" }]);
    await manager.release();
    expect(await fs.readFile("/generated.txt", { encoding: "utf8" })).toBe("generated");

    queueFakeWorkspaceChanges(provider, [{ operation: "write", path: "/shared.txt", content: "sandbox" }]);
    await fs.writeFile("/shared.txt", "host-newer");
    await manager.release();
    expect(await fs.readFile("/shared.txt", { encoding: "utf8" })).toBe("host-newer");
  });
});

describe("sandbox model tools", () => {
  it("exposes six default tools and snapshots only for stateful profiles", () => {
    expect(getSandboxToolsForProfile("web_app")).toEqual([
      "sandbox_inspect", "sandbox_run", "sandbox_process", "sandbox_packages", "sandbox_preview", "sandbox_network",
    ]);
    expect(getSandboxToolsForProfile("stateful")).toContain("sandbox_snapshot");
    expect(getSandboxToolsForProfile("web_app", ["runtime.code"])).toEqual(["sandbox_inspect"]);
    expect(sandboxPlugin().id).toBe("agent-harness.sandbox");
  });

  it("strictly validates operation-specific fields", () => {
    const tools = createSandboxTools();
    expect(() => parseToolInput(tools.sandbox_run!.schema, { operation: "code", code: "1", command: "bad" })).toThrow();
    expect(() => parseToolInput(tools.sandbox_process!.schema, { operation: "read" })).toThrow();
    expect(() => parseToolInput(tools.sandbox_snapshot!.schema, { operation: "restore" })).toThrow();
  });

  it("returns JSON structured results and normalized operational errors", async () => {
    const { manager, platform } = setup();
    const services = new ServiceResolver({ [SANDBOX_SERVICE.id]: manager });
    const context = {
      runId: "run", operationId: "operation", signal: new AbortController().signal,
      scope: { conversationId: "conversation" }, state: {}, runtime: new RunContext(), services, platform,
    };
    const tools = createSandboxTools();
    const success = await executeTool(tools.sandbox_run!, { operation: "code", code: "2 + 2" }, context);
    expect(success).toMatchObject({ meta: { operationId: "operation" }, structuredContent: { ok: true, operation: "code" } });
    expect(success.isError).toBeUndefined();
    const failure = await executeTool(tools.sandbox_process!, { operation: "read", processId: "missing" }, context);
    expect(failure).toMatchObject({ isError: true, structuredContent: { ok: false, error: { code: "process_not_found" } } });
  });
});
