import { describe, expect, it } from "vitest";
import {
  RunContext,
  ServiceResolver,
  createHarness,
  executeTool,
  type BaseTool,
  type ToolExecutionContext,
} from "@memorall/agent-harness-core";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import { langGraphPlugin } from "@memorall/agent-harness-langgraph";
import {
  CHILD_AGENT_SERVICE,
  COMPACTION_SERVICE,
  FILESYSTEM_SERVICE,
  HTML_CONTENT_PROCESSOR,
  SKILL_SERVICE,
  WEB_BROWSER_SERVICE,
  createFilesystemTools,
  createPlannerTools,
  createWebTools,
  standardToolsPlugin,
  type DirEntry,
  type FileStat,
  type HarnessFileSystem,
  type WebBrowserService,
  type WebSession,
} from "../index.js";

class MemoryFs implements HarnessFileSystem {
  files = new Map<string, string>();
  directories = new Set(["/"]);
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: "utf8" | "utf-8" | "base64" | "hex" | "latin1" }): Promise<string>;
  async readFile(path: string, options?: object): Promise<Uint8Array | string> { const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return options ? value : new TextEncoder().encode(value); }
  async writeFile(path: string, data: string | Uint8Array) { this.files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data)); }
  async appendFile(path: string, data: string | Uint8Array) { await this.writeFile(path, `${this.files.get(path) ?? ""}${typeof data === "string" ? data : new TextDecoder().decode(data)}`); }
  async unlink(path: string) { this.files.delete(path); }
  async rename(oldPath: string, newPath: string) { await this.writeFile(newPath, this.files.get(oldPath) ?? ""); this.files.delete(oldPath); }
  async copyFile(src: string, dest: string) { await this.writeFile(dest, this.files.get(src) ?? ""); }
  async mkdir(path: string) { this.directories.add(path); return path; }
  async rmdir(path: string) { this.directories.delete(path); }
  async rm(path: string) { this.files.delete(path); this.directories.delete(path); }
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  async readdir(path: string, options?: object): Promise<string[] | DirEntry[]> {
    const prefix = path === "/" ? "/" : `${path}/`;
    const values = new Map<string, boolean>();
    for (const directory of this.directories) { const part = directory.startsWith(prefix) ? directory.slice(prefix.length) : ""; if (part && !part.includes("/")) values.set(part, true); }
    for (const file of this.files.keys()) { const part = file.startsWith(prefix) ? file.slice(prefix.length) : ""; if (part && !part.includes("/")) values.set(part, false); }
    return options ? [...values].map(([name, directory]) => ({ name, isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false })) : [...values.keys()];
  }
  async stat(path: string): Promise<FileStat> { const file = this.files.get(path); return { isFile: () => file !== undefined, isDirectory: () => this.directories.has(path), isSymbolicLink: () => false, size: file?.length ?? 0, mtime: new Date(0) }; }
  async access(path: string) { if (!this.files.has(path) && !this.directories.has(path)) throw new Error("missing"); }
}

const context = (services: Record<string, unknown>, runtime = new RunContext()): ToolExecutionContext => ({
  runId: "run", operationId: "operation", signal: new AbortController().signal,
  scope: { tenant: "test" }, state: {}, runtime,
  services: new ServiceResolver(services), platform: createTestPlatform(),
});

const byName = (tools: readonly BaseTool[], name: string): BaseTool => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
};

describe("standard capability packs", () => {
  it("covers every filesystem operation with structured results", async () => {
    const fs = new MemoryFs();
    fs.directories.add("/src");
    const tools = createFilesystemTools();
    const execution = context({ fs });
    await executeTool(byName(tools, "fs_write"), { path: "src/a.ts", content: "alpha\nbeta" }, execution);
    expect((await executeTool(byName(tools, "fs_read"), { path: "/src/a.ts" }, execution)).content).toBe("alpha\nbeta");
    expect((await executeTool(byName(tools, "fs_edit"), { path: "/src/a.ts", old_text: "beta", new_text: "gamma" }, execution)).isError).toBeUndefined();
    await executeTool(byName(tools, "fs_mkdir"), { path: "/out" }, execution);
    expect((await executeTool(byName(tools, "fs_ls"), { path: "/" }, execution)).content).toContain("d src");
    expect((await executeTool(byName(tools, "fs_glob"), { path: "/", pattern: "**/*.ts" }, execution)).content).toContain("/src/a.ts");
    expect((await executeTool(byName(tools, "fs_grep"), { path: "/", pattern: "gamma" }, execution)).content).toContain("/src/a.ts:2:gamma");
    await executeTool(byName(tools, "fs_remove"), { path: "/src/a.ts" }, execution);
    expect(fs.files.has("/src/a.ts")).toBe(false);
  });

  it("covers web session open/read/search/query/action/wait and disposable cleanup", async () => {
    const session: WebSession = { id: "web:1", requestedUrl: "https://example.test", currentUrl: "https://example.test", title: "Example", html: "<main><button>Go</button></main>", text: "Go", domAccessible: true };
    const calls: string[] = [];
    const browser: WebBrowserService = {
      capabilities: () => ({ supported: ["session.open", "content.read"] }),
      open: async () => { calls.push("open"); return { session, disposable: true }; },
      get: async () => session,
      close: async () => { calls.push("close"); },
      list: async () => [session],
      search: async () => [{ text: "Go", index: 0 }],
      query: async () => [{ tagName: "button", text: "Go" }],
      action: async () => ({ clicked: true }),
      wait: async () => ({ ready: true }),
    };
    const processor = { extract: () => ({ content: "processed", matchCount: 1 }) };
    const execution = context({ [WEB_BROWSER_SERVICE.id]: browser, [HTML_CONTENT_PROCESSOR.id]: processor });
    const tools = createWebTools();
    expect((await executeTool(byName(tools, "web_open"), { url: session.currentUrl }, execution)).structuredContent).toMatchObject({ actionType: "web_open" });
    expect((await executeTool(byName(tools, "web_read"), { url: session.currentUrl, selector: "main" }, execution)).structuredContent).toMatchObject({ content: "processed", matchCount: 1 });
    expect(calls).toContain("close");
    expect((await executeTool(byName(tools, "web_search"), { sessionId: session.id, pattern: "Go" }, execution)).structuredContent).toMatchObject({ matches: [{ text: "Go" }] });
    expect((await executeTool(byName(tools, "web_dom"), { operation: "query", sessionId: session.id, selector: "button" }, execution)).structuredContent).toHaveProperty("output");
    expect((await executeTool(byName(tools, "web_dom"), { operation: "action", sessionId: session.id, selector: "button", action: "click" }, execution)).structuredContent).toMatchObject({ output: { clicked: true } });
    expect((await executeTool(byName(tools, "web_wait"), { sessionId: session.id, kind: "render" }, execution)).structuredContent).toMatchObject({ output: { ready: true } });
  });

  it("keeps planner state run-local and exercises skills and delegation ports", async () => {
    const runtime = new RunContext();
    const execution = context({
      [SKILL_SERVICE.id]: { list: async () => [{ name: "known", description: "Known" }], load: async (name: string) => { if (name !== "known") throw new Error("missing"); return { name, description: "Known", body: "instructions" }; } },
      [CHILD_AGENT_SERVICE.id]: { send: async ({ agentId, message }: { agentId: string; message: string }) => ({ response: `${agentId}:${message}` }) },
    }, runtime);
    const planner = createPlannerTools();
    await executeTool(byName(planner, "planner_create"), { title: "Work", items: "one;two" }, execution);
    await executeTool(byName(planner, "planner_add_item"), { description: "three" }, execution);
    await executeTool(byName(planner, "planner_check_item"), { id: "2" }, execution);
    await executeTool(byName(planner, "planner_remove_item"), { id: "1" }, execution);
    expect((await executeTool(byName(planner, "planner_get"), {}, execution)).content).toContain("[x] 2. two");

    const harness = createHarness({ platform: createTestPlatform(), plugins: [standardToolsPlugin({ filesystem: false, web: false, planner: false, compaction: false, chat: false })], services: execution.services.snapshot() });
    expect(harness.inspect().tools).toEqual(expect.arrayContaining(["load_skill", "send_message_to_agent"]));
  });

  it("composes chat and compaction steps through the generic linear graph", async () => {
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [
        langGraphPlugin({ agent: false, linear: { id: "prepare", steps: ["add-system", "current-time", "auto-compact"] } }),
        standardToolsPlugin({ filesystem: false, web: false, planner: false, skills: false, multiAgent: false, chat: { content: "system" }, compaction: { maxTokens: 100 } }),
      ],
      services: { [COMPACTION_SERVICE.id]: { compact: async ({ state, maxTokens }: { state: unknown; maxTokens?: number }) => ({ state, maxTokens }) } },
    });
    const result = await harness.run({ graph: "prepare", input: { messages: [{ role: "user", content: "hello" }] } }).result();
    expect(result.output).toMatchObject({ maxTokens: 100, state: { currentTime: expect.any(String), messages: [{ role: "system", content: "system" }, { role: "user", content: "hello" }] } });
  });
});
