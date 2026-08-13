import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertJsonValue, type JsonValue } from "@memorall/agent-harness-core";
import type {
  SandboxCallContext,
  SandboxCodeRunResult,
  SandboxCommandRunResult,
  SandboxLogEntry,
  SandboxOutputEvent,
  SandboxPackageResult,
  SandboxProcessInfo,
  SandboxProvider,
  SandboxProviderSession,
  SandboxRunRequest,
  SandboxSessionDescriptor,
  SandboxWorkspaceChange,
  SandboxWorkspaceManifest,
} from "@memorall/agent-harness-sandbox";
import { SandboxError } from "@memorall/agent-harness-sandbox";

export interface NodeLocalSandboxProviderOptions {
  readonly id?: string;
  readonly temporaryDirectory?: string;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
  readonly maxOutputChars?: number;
  /** Real Node executable used for JavaScript runs (desktop bundles Node 22). */
  readonly nodeExecutable?: string;
  /** npm CLI executable or script path paired with the selected Node runtime. */
  readonly npmExecutable?: string;
  /** Explicit child environment. Callers should pass an allowlisted environment. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

interface LocalProcess {
  id: string;
  command: string;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  events: SandboxOutputEvent[];
  status: SandboxProcessInfo["status"];
  exitCode?: number;
  startedAt: number;
  updatedAt: number;
}

const checkCall = (context: SandboxCallContext, now: () => number): void => {
  if (context.signal?.aborted) throw new SandboxError("timeout", "Sandbox operation was cancelled", { retryable: true });
  if (context.deadlineMs !== undefined && now() > context.deadlineMs) throw new SandboxError("timeout", "Sandbox operation deadline exceeded", { retryable: true });
};

const sandboxPath = (root: string, requested = "/"): string => {
  const normalized = requested.replace(/\\/g, "/");
  const resolved = path.resolve(root, `.${normalized.startsWith("/") ? normalized : `/${normalized}`}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new SandboxError("invalid_request", `Path leaves sandbox workspace: ${requested}`);
  return resolved;
};

const scanFiles = async (root: string): Promise<Map<string, string>> => {
  const output = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.set(`/${path.relative(root, absolute).replace(/\\/g, "/")}`, await readFile(absolute, "utf8"));
    }
  };
  await visit(root);
  return output;
};

const parseCursor = (cursor?: string): [number, number] => {
  const [event = "0", character = "0"] = (cursor ?? "0:0").split(":");
  return [Number.parseInt(event, 10) || 0, Number.parseInt(character, 10) || 0];
};

const asJson = (value: unknown): JsonValue => {
  assertJsonValue(value, "Node sandbox result");
  return value;
};

const processPage = (process: LocalProcess, cursor?: string, maxChars = 64_000) => {
  let [index, offset] = parseCursor(cursor);
  const events: SandboxOutputEvent[] = [];
  let remaining = maxChars;
  while (index < process.events.length && remaining > 0) {
    const source = process.events[index]!;
    const text = source.text ?? "";
    const chunk = text.slice(offset, offset + remaining);
    events.push({ ...source, ...(source.text === undefined ? {} : { text: chunk }) });
    remaining -= chunk.length;
    offset += chunk.length;
    if (offset >= text.length) { index += 1; offset = 0; }
  }
  return {
    processId: process.id,
    events,
    nextCursor: `${index}:${offset}`,
    status: process.status,
    exitCode: process.exitCode,
    truncated: index < process.events.length,
  };
};

export class NodeLocalSandboxProvider implements SandboxProvider {
  readonly id: string;
  readonly contractVersion = 1 as const;
  readonly #options: Required<Pick<NodeLocalSandboxProviderOptions, "now" | "randomUUID" | "maxOutputChars">> & NodeLocalSandboxProviderOptions;

  constructor(options: NodeLocalSandboxProviderOptions = {}) {
    this.id = options.id ?? "node-local";
    this.#options = {
      ...options,
      now: options.now ?? (() => Date.now()),
      randomUUID: options.randomUUID ?? randomUUID,
      maxOutputChars: options.maxOutputChars ?? 200_000,
    };
  }

  async createSession(_request: unknown, context: SandboxCallContext): Promise<SandboxProviderSession> {
    checkCall(context, this.#options.now);
    const root = await mkdtemp(path.join(this.#options.temporaryDirectory ?? tmpdir(), "agent-harness-"));
    const providerSessionId = this.#options.randomUUID();
    const createdAt = this.#options.now();
    const descriptor: SandboxSessionDescriptor = {
      sessionId: `node:${providerSessionId}`,
      providerId: this.id,
      providerSessionId,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
    };
    const processes = new Map<string, LocalProcess>();
    const logs: SandboxLogEntry[] = [];
    let baseline = new Map<string, string>();
    let closed = false;

    const pushEvent = (process: LocalProcess, type: SandboxOutputEvent["type"], text?: string) => {
      const event = { type, ...(text === undefined ? {} : { text }), timestamp: this.#options.now() };
      process.events.push(event);
      process.updatedAt = event.timestamp;
      if (type !== "status" && text) logs.push({ level: type === "stderr" ? "error" : "log", message: text, timestamp: event.timestamp });
    };

    const start = (command: string, args: readonly string[], cwd: string, options: { shell?: boolean; timeoutMs?: number } = {}): LocalProcess => {
      const id = `process:${this.#options.randomUUID()}`;
      const child = spawn(command, [...args], {
        cwd,
        shell: options.shell ?? false,
        env: { ...(this.#options.environment ?? process.env) } as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
      const active: LocalProcess = { id, command: [command, ...args].join(" "), cwd, child, events: [], status: "running", startedAt: this.#options.now(), updatedAt: this.#options.now() };
      processes.set(id, active);
      child.stdout.on("data", (data: Uint8Array) => pushEvent(active, "stdout", new TextDecoder().decode(data)));
      child.stderr.on("data", (data: Uint8Array) => pushEvent(active, "stderr", new TextDecoder().decode(data)));
      child.on("error", (error) => { active.status = "failed"; pushEvent(active, "stderr", error.message); });
      child.on("close", (code, signal) => {
        active.exitCode = code ?? undefined;
        active.status = signal ? "stopped" : code === 0 ? "completed" : "failed";
        pushEvent(active, "status", active.status);
      });
      if (options.timeoutMs) {
        const timer = setTimeout(() => { if (active.status === "running") child.kill(); }, options.timeoutMs);
        timer.unref?.();
        child.once("close", () => clearTimeout(timer));
      }
      return active;
    };

    const waitForExit = async (process: LocalProcess, timeoutMs?: number): Promise<void> => {
      if (process.status !== "running") return;
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); resolve(); };
        process.child.once("close", done);
        const timer = setTimeout(() => { process.child.off("close", done); resolve(); }, timeoutMs ?? 30_000);
        timer.unref?.();
      });
    };

    const waitForProcessOutput = async (
      active: LocalProcess,
      context: SandboxCallContext,
      waitMs: number,
    ): Promise<void> => {
      const deadlineWait = context.deadlineMs === undefined
        ? waitMs
        : Math.min(waitMs, Math.max(0, context.deadlineMs - this.#options.now()));
      if (deadlineWait <= 0) {
        checkCall(context, this.#options.now);
        return;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          active.child.stdout.off("data", finish);
          active.child.stderr.off("data", finish);
          active.child.off("close", finish);
          active.child.off("error", finish);
          context.signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, deadlineWait);
        timer.unref?.();
        active.child.stdout.once("data", finish);
        active.child.stderr.once("data", finish);
        active.child.once("close", finish);
        active.child.once("error", finish);
        context.signal?.addEventListener("abort", finish, { once: true });
      });
      checkCall(context, this.#options.now);
    };

    const runForeground = async (request: Exclude<SandboxRunRequest, { operation: "command" | "repl" }>, context: SandboxCallContext): Promise<SandboxCodeRunResult> => {
      checkCall(context, this.#options.now);
      const target = request.operation === "code" ? ["-e", request.code] : [sandboxPath(root, request.path)];
      const active = start(this.#options.nodeExecutable ?? process.execPath, target, root, { timeoutMs: request.timeoutMs });
      await waitForExit(active, request.timeoutMs);
      if (active.status === "running") active.child.kill();
      const stdout = active.events.filter(({ type }) => type === "stdout").map(({ text }) => text ?? "").join("");
      const stderr = active.events.filter(({ type }) => type === "stderr").map(({ text }) => text ?? "").join("");
      const maxLogs = request.maxLogEntries ?? 100;
      const operationLogs = active.events.filter(({ type }) => type !== "status").slice(0, maxLogs).map((event) => ({ level: event.type === "stderr" ? "error" as const : "log" as const, message: event.text ?? "", timestamp: event.timestamp }));
      return {
        kind: request.operation,
        status: active.status === "completed" ? "ok" : active.status === "running" ? "timeout" : "error",
        durationMs: Math.max(0, active.updatedAt - active.startedAt),
        result: stdout.slice(0, this.#options.maxOutputChars),
        ...(stderr ? { error: stderr.slice(0, this.#options.maxOutputChars) } : {}),
        logs: operationLogs,
        truncatedLogs: Math.max(0, active.events.length - maxLogs),
        ...(request.operation === "file" ? { path: request.path } : {}),
      };
    };

    const session: SandboxProviderSession = {
      descriptor,
      capabilities: {
        supported: ["runtime.code", "runtime.file", "runtime.command", "process.background", "process.stdin", "packages.install", "packages.manifest", "network.fetch", "workspace.mount", "workspace.flush"],
        packageManagers: ["npm"],
        limits: { maxConcurrentSessions: 32, maxOutputChars: this.#options.maxOutputChars, maxLogEntries: 500 },
      },
      runtime: {
        run: async (request, operationContext) => {
          if (request.operation === "repl") throw new SandboxError("capability_unavailable", "Persistent REPL is not supported by node-local");
          if (request.operation !== "command") return runForeground(request, operationContext);
          checkCall(operationContext, this.#options.now);
          const active = start(request.command, [], sandboxPath(root, request.cwd ?? "/"), { shell: true, timeoutMs: request.commandTimeoutMs });
          if ((request.waitTimeoutMs ?? 0) > 0) await waitForExit(active, request.waitTimeoutMs);
          return { kind: "command", ...processPage(active), command: request.command, cwd: request.cwd ?? "/", completed: active.status !== "running", startedAt: active.startedAt, updatedAt: active.updatedAt } as SandboxCommandRunResult;
        },
      },
      processes: {
        manage: async (request, operationContext) => {
          checkCall(operationContext, this.#options.now);
          if (request.operation === "list") return { processes: [...processes.values()].map((process) => ({ processId: process.id, command: process.command, cwd: process.cwd, status: process.status, outputTail: process.events.slice(-20).map(({ text }) => text ?? "").join("").slice(-4_000), nextCursor: `${process.events.length}:0`, updatedAt: process.updatedAt })) };
          const active = processes.get(request.processId);
          if (!active) throw new SandboxError("process_not_found", `Unknown process: ${request.processId}`);
          if (request.operation === "stdin") { active.child.stdin.write(`${request.input}${request.appendNewline ? "\n" : ""}`); return { processId: request.processId, sent: true }; }
          if (request.operation === "stop") { active.child.kill(); active.status = "stopped"; return { processId: request.processId, stopped: true }; }
          let page = processPage(active, request.cursor, request.maxChars);
          if (page.events.length === 0 && page.status === "running" && (request.waitMs ?? 0) > 0) {
            await waitForProcessOutput(active, operationContext, request.waitMs!);
            page = processPage(active, request.cursor, request.maxChars);
          }
          return page;
        },
      },
      workspace: {
        bind: async (manifest: SandboxWorkspaceManifest | undefined, operationContext) => {
          checkCall(operationContext, this.#options.now);
          if (manifest?.mode !== "incremental") { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); await mkdir(root, { recursive: true }); }
          for (const directory of manifest?.directories ?? []) await mkdir(sandboxPath(root, directory), { recursive: true });
          for (const deleted of manifest?.deletedPaths ?? []) await rm(sandboxPath(root, deleted), { recursive: true, force: true });
          for (const file of manifest?.files ?? []) { const target = sandboxPath(root, file.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, file.content, "utf8"); }
          baseline = await scanFiles(root);
          return { changedPaths: [...(manifest?.files.map(({ path }) => path) ?? []), ...(manifest?.deletedPaths ?? [])], conflicts: [] };
        },
        flush: async (operationContext) => {
          checkCall(operationContext, this.#options.now);
          const current = await scanFiles(root);
          const changes: SandboxWorkspaceChange[] = [];
          for (const [file, content] of current) if (baseline.get(file) !== content) changes.push({ operation: "write", path: file, content });
          for (const file of baseline.keys()) if (!current.has(file)) changes.push({ operation: "delete", path: file });
          baseline = current;
          return { changedPaths: changes.flatMap((change) => change.operation === "rename" ? [change.oldPath, change.newPath] : [change.path]), conflicts: [], changes };
        },
      },
      packages: {
        manage: async (request, operationContext): Promise<SandboxPackageResult> => {
          checkCall(operationContext, this.#options.now);
          const args = request.operation === "install" ? ["install", request.packageSpec, ...(request.saveDev ? ["--save-dev"] : request.save === false ? ["--no-save"] : [])] : request.operation === "install_from_package_json" ? ["install"] : ["ls", "--depth=0", "--json"];
          const active = start(
            this.#options.npmExecutable ?? (process.platform === "win32" ? "npm.cmd" : "npm"),
            args,
            root,
          );
          await waitForExit(active, 600_000);
          const stdout = active.events.filter(({ type }) => type === "stdout").map(({ text }) => text ?? "").join("");
          let packages: Record<string, string> = {};
          if (request.operation === "list") {
            try { const parsed = JSON.parse(stdout) as { dependencies?: Record<string, { version?: string }> }; packages = Object.fromEntries(Object.entries(parsed.dependencies ?? {}).map(([name, value]) => [name, value.version ?? "unknown"])); } catch { packages = {}; }
          }
          return { success: active.status === "completed", packages };
        },
      },
      network: {
        fetch: async (request, operationContext) => {
          checkCall(operationContext, this.#options.now);
          const controller = new AbortController();
          const timeout = request.timeoutMs ? setTimeout(() => controller.abort(), request.timeoutMs) : undefined;
          operationContext.signal?.addEventListener("abort", () => controller.abort(), { once: true });
          try {
            const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
            const body = (await response.text()).slice(0, request.maxChars ?? this.#options.maxOutputChars);
            const contentType = response.headers.get("content-type") ?? "text/plain";
            const responseType = request.responseType && request.responseType !== "auto" ? request.responseType : contentType.includes("json") ? "json" : contentType.includes("html") ? "html" : "text";
            return { url: response.url, status: response.status, ok: response.ok, contentType, responseType, body };
          } finally { if (timeout) clearTimeout(timeout); }
        },
      },
      inspect: async (request, operationContext) => {
        checkCall(operationContext, this.#options.now);
        if (request.operation === "logs") return asJson({ logs: logs.slice(-(request.limit ?? 100)).map((entry) => ({ ...entry })) });
        if (request.operation === "clear_logs") { logs.length = 0; return asJson({ cleared: true }); }
        if (request.operation === "reset") { for (const active of processes.values()) active.child.kill(); processes.clear(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); await mkdir(root, { recursive: true }); baseline.clear(); return asJson({ reset: true }); }
        return asJson({ ...descriptor, processCount: processes.size });
      },
      reset: async (operationContext) => { await session.inspect({ operation: "reset" }, operationContext); },
      close: async (operationContext) => {
        checkCall(operationContext, this.#options.now);
        if (closed) return;
        closed = true;
        await Promise.all([...processes.values()].map(async (active) => {
          if (active.status !== "running") return;
          active.child.kill();
          await waitForExit(active, 2_000);
        }));
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        descriptor.status = "stopped";
      },
    };
    return session;
  }
}
