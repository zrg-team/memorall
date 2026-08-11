import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = process.cwd();
const packs = path.join(os.tmpdir(), "memorall-agent-harness-packs");
const fixture = path.join(os.tmpdir(), "memorall-agent-harness-consumer");
await rm(fixture, { recursive: true, force: true });
await mkdir(fixture, { recursive: true });

const tarballs = (await readdir(packs)).filter((name) => name.endsWith(".tgz"));
if (tarballs.length !== 9) throw new Error(`Expected 9 harness tarballs, found ${tarballs.length}`);
const packageNames = {
  "memorall-agent-harness-core-0.1.0.tgz": "@memorall/agent-harness-core",
  "memorall-agent-harness-langgraph-0.1.0.tgz": "@memorall/agent-harness-langgraph",
  "memorall-agent-harness-standard-0.1.0.tgz": "@memorall/agent-harness-standard",
  "memorall-agent-harness-sandbox-0.1.0.tgz": "@memorall/agent-harness-sandbox",
  "memorall-agent-harness-mcp-0.1.0.tgz": "@memorall/agent-harness-mcp",
  "memorall-agent-harness-browser-0.1.0.tgz": "@memorall/agent-harness-browser",
  "memorall-agent-harness-node-0.1.0.tgz": "@memorall/agent-harness-node",
  "memorall-agent-harness-compat-0.1.0.tgz": "@memorall/agent-harness-compat",
  "memorall-agent-harness-0.1.0.tgz": "@memorall/agent-harness",
};
const dependencies = Object.fromEntries(Object.entries(packageNames).map(([file, name]) => [
  name,
  `file:${path.join(packs, file).replaceAll("\\", "/")}`,
]));

await writeFile(path.join(fixture, "package.json"), JSON.stringify({
  private: true,
  type: "module",
  scripts: { typecheck: "tsc -p tsconfig.json", build: "vite build" },
  dependencies: { ...dependencies, vite: "8.0.16" },
  devDependencies: { "@types/node": "24.3.1", typescript: "5.9.2" },
}, null, 2));
await writeFile(path.join(fixture, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    lib: ["ES2022", "DOM", "WebWorker"],
    skipLibCheck: true,
  },
  include: ["type-smoke.ts"],
}, null, 2));
await writeFile(path.join(fixture, "type-smoke.ts"), `
import type { AgentHarness, HarnessPlatform } from "@memorall/agent-harness-core";
import { createFullHarness } from "@memorall/agent-harness";
import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import { NodeFileSystem } from "@memorall/agent-harness-node";
import { SandboxProviderRegistry } from "@memorall/agent-harness-sandbox";
import { FILESYSTEM_SERVICE } from "@memorall/agent-harness-standard/filesystem";
import type { McpHttpServerConfig } from "@memorall/agent-harness-mcp/http";
const browser: HarnessPlatform = createBrowserPlatform({ randomUUID: () => "id" });
const server: McpHttpServerConfig = { id: "remote", url: "https://example.test/mcp" };
const registry = new SandboxProviderRegistry();
const fs = new NodeFileSystem();
const harness: AgentHarness = createFullHarness({ platform: browser, services: { [FILESYSTEM_SERVICE.id]: fs }, preset: { sandbox: false } });
void server; void registry; void harness;
`);
await writeFile(path.join(fixture, "node-smoke.mjs"), `
import assert from "node:assert/strict";
import { createFullHarness, jsonToolSchema, MODEL_SERVICE } from "@memorall/agent-harness";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
const model = { async *stream(request) {
  if (!request.messages.some((message) => message.role === "tool")) yield { type: "completed", message: { role: "assistant", content: "", toolCalls: [{ id: "call", name: "echo", arguments: '{"value":"packed"}' }] } };
  else yield { type: "completed", message: { role: "assistant", content: "packed-ok" } };
} };
const custom = { id: "consumer", version: "1.0.0", register({ registerTool }) { registerTool("echo", () => ({ name: "echo", description: "echo", schema: jsonToolSchema({ type: "object" }), execute: async ({ value }) => String(value) })); } };
const harness = createFullHarness({ platform: createTestPlatform(), services: { [MODEL_SERVICE.id]: model }, preset: { standard: false, sandbox: false, plugins: [custom] } });
const result = await harness.run({ graph: "agent", input: { messages: [], tools: ["echo"] } }).result();
assert.equal(result.output.response, "packed-ok");
assert.deepEqual((await import("@memorall/agent-harness-standard/filesystem")).FILESYSTEM_SERVICE.id, "fs");
assert.equal((await import("@memorall/agent-harness-node/playwright")).PLAYWRIGHT_ADAPTER_ID, "node.playwright");
console.log("Node packed consumer passed");
`);
await writeFile(path.join(fixture, "index.html"), '<main><output id="result" data-status="loading">loading</output></main><script type="module" src="/browser-main.js"></script>');
await writeFile(path.join(fixture, "minimal.html"), '<output id="minimal"></output><script type="module" src="/minimal.js"></script>');
await writeFile(path.join(fixture, "minimal.js"), `
import { createHarness } from "@memorall/agent-harness-core";
const platform = { runtime: "browser", now: () => 1, randomUUID: () => "minimal", schedule: () => ({ cancel() {} }) };
document.querySelector("#minimal").textContent = String(createHarness({ platform }).inspect().contractVersion);
`);
await writeFile(path.join(fixture, "worker.js"), `
import { createHarness } from "@memorall/agent-harness-core";
const platform = { runtime: "worker", now: () => 1, randomUUID: () => "worker", schedule: () => ({ cancel() {} }), fetch: globalThis.fetch };
self.onmessage = () => self.postMessage(createHarness({ platform }).inspect());
`);
await writeFile(path.join(fixture, "service-worker.js"), `
import { createHarness } from "@memorall/agent-harness-core";
const platform = { runtime: "service-worker", now: () => 1, randomUUID: () => "sw", schedule: () => ({ cancel() {} }), fetch: globalThis.fetch };
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => event.ports[0].postMessage(createHarness({ platform }).inspect()));
`);
await writeFile(path.join(fixture, "browser-main.js"), `
import { createHarness, jsonToolSchema, MODEL_SERVICE, langGraphPlugin } from "@memorall/agent-harness";
import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import workerUrl from "./worker.js?worker&url";
import serviceWorkerUrl from "./service-worker.js?worker&url";
const output = document.querySelector("#result");
try {
const model = { async *stream(request) {
  if (!request.messages.some((message) => message.role === "tool")) yield { type: "completed", message: { role: "assistant", content: "", toolCalls: [{ id: "browser-call", name: "echo", arguments: '{"value":"browser"}' }] } };
  else yield { type: "completed", message: { role: "assistant", content: "browser-ok" } };
} };
const custom = { id: "browser-consumer", version: "1.0.0", register({ registerTool }) { registerTool("echo", () => ({ name: "echo", description: "echo", schema: jsonToolSchema({ type: "object" }), execute: async ({ value }) => String(value) })); } };
const harness = createHarness({ platform: createBrowserPlatform(), services: { [MODEL_SERVICE.id]: model }, plugins: [langGraphPlugin(), custom] });
const result = await harness.run({ graph: "agent", input: { messages: [], tools: ["echo"] } }).result();
const workerResult = await new Promise((resolve, reject) => { const worker = new Worker(workerUrl, { type: "module" }); worker.onmessage = ({ data }) => { worker.terminate(); resolve(data); }; worker.onerror = reject; worker.postMessage("inspect"); });
const registration = await navigator.serviceWorker.register(serviceWorkerUrl, { type: "module", scope: "/" });
await navigator.serviceWorker.ready;
const serviceWorkerResult = await new Promise((resolve, reject) => { const channel = new MessageChannel(); channel.port1.onmessage = ({ data }) => resolve(data); channel.port1.onmessageerror = reject; (registration.active ?? registration.waiting ?? registration.installing).postMessage("inspect", [channel.port2]); });
output.textContent = JSON.stringify({ response: result.output.response, worker: workerResult.contractVersion, serviceWorker: serviceWorkerResult.contractVersion });
output.dataset.status = "ready";
} catch (error) {
  output.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  output.dataset.status = "error";
  throw error;
}
`);

execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: fixture, stdio: "inherit", shell: process.platform === "win32" });
execFileSync("npm", ["run", "typecheck"], { cwd: fixture, stdio: "inherit", shell: process.platform === "win32" });
execFileSync(process.execPath, ["node-smoke.mjs"], { cwd: fixture, stdio: "inherit" });
execFileSync("npm", ["run", "build"], { cwd: fixture, stdio: "inherit", shell: process.platform === "win32" });

const distFiles = (await readdir(path.join(fixture, "dist"), { recursive: true })).filter((file) => typeof file === "string" && file.endsWith(".js"));
for (const file of distFiles) {
  const content = await readFile(path.join(fixture, "dist", file), "utf8");
  if (/node:(fs|path|child_process)|chrome\.|src\/services|flow-core/.test(content)) throw new Error(`Browser bundle contains forbidden runtime code: ${file}`);
}

const vite = await import(pathToFileURL(path.join(fixture, "node_modules", "vite", "dist", "node", "index.js")).href);
await vite.build({
  root: fixture,
  logLevel: "silent",
  build: {
    outDir: "dist-minimal",
    emptyOutDir: true,
    rollupOptions: { input: path.join(fixture, "minimal.html") },
  },
});
const minimalFiles = (await readdir(path.join(fixture, "dist-minimal"), { recursive: true }))
  .filter((file) => typeof file === "string" && file.endsWith(".js"));
const minimalChunks = await Promise.all(
  minimalFiles.map((file) => readFile(path.join(fixture, "dist-minimal", file), "utf8")),
);
const minimalBundle = minimalChunks.join("\n");
if (Buffer.byteLength(minimalBundle) > 150_000) {
  throw new Error(`Minimal core browser bundle is unexpectedly large: ${Buffer.byteLength(minimalBundle)} bytes`);
}
if (/sandbox_inspect|McpClientManager|StateGraph|NodeLocalSandboxProvider/.test(minimalBundle)) {
  throw new Error("Minimal core browser bundle contains an unused optional capability");
}
const server = await vite.preview({ root: fixture, preview: { host: "127.0.0.1", port: 41739, strictPort: true, headers: { "Service-Worker-Allowed": "/" } } });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:41739", { waitUntil: "networkidle" });
  await page.locator("#result:not([data-status=loading])").waitFor();
  if (await page.locator("#result").getAttribute("data-status") !== "ready") {
    throw new Error(`Browser smoke failed: ${await page.locator("#result").textContent()}; ${errors.join("; ")}`);
  }
  const value = JSON.parse(await page.locator("#result").textContent());
  if (value.response !== "browser-ok" || value.worker !== 1 || value.serviceWorker !== 1) throw new Error(`Unexpected browser smoke result: ${JSON.stringify(value)}`);
  if (errors.length) throw new Error(`Browser consumer errors: ${errors.join("; ")}`);
} finally {
  await browser.close();
  await server.close();
}

console.log(`Packed Node, browser, worker, and service-worker consumers passed in ${fixture}`);
