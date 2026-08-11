import { assertJsonValue, type JsonValue } from "@memorall/agent-harness-core";
import type {
  SandboxCallContext,
  SandboxCapabilities,
  SandboxCommandRunResult,
  SandboxLogEntry,
  SandboxOutputEvent,
  SandboxPreviewDescriptor,
  SandboxProcessInfo,
  SandboxProvider,
  SandboxProviderSession,
  SandboxSessionDescriptor,
  SandboxSessionRequest,
  SandboxSnapshotResult,
  SandboxWorkspaceChange,
  SandboxWorkspaceManifest,
} from "./contracts.js";
import { SandboxError } from "./contracts.js";

export const SANDBOX_CONTRACT_VERSION = 1;

export interface FakeRemoteSandboxState {
  readonly calls: string[];
  readonly files: Map<string, string>;
  readonly processes: Map<string, SandboxProcessInfo & { events: SandboxOutputEvent[] }>;
  readonly previews: Map<string, SandboxPreviewDescriptor>;
  readonly snapshots: Map<string, Map<string, string>>;
  readonly logs: SandboxLogEntry[];
  readonly pendingWorkspaceChanges: SandboxWorkspaceChange[];
  closed: boolean;
  resetCount: number;
}

export interface FakeRemoteSandboxProvider extends SandboxProvider {
  readonly state: FakeRemoteSandboxState;
}

const DEFAULT_CAPABILITIES: SandboxCapabilities = {
  supported: [
    "runtime.code", "runtime.file", "runtime.command", "runtime.repl",
    "process.background", "process.stdin", "packages.install", "packages.manifest",
    "preview.start", "preview.request", "preview.render", "network.fetch",
    "snapshot.capture", "snapshot.restore", "workspace.mount", "workspace.flush",
  ],
  packageManagers: ["npm"],
  limits: { maxConcurrentSessions: 8, maxOutputChars: 200_000, maxLogEntries: 500 },
};

const call = (state: FakeRemoteSandboxState, name: string, context: SandboxCallContext): void => {
  if (context.signal?.aborted) throw new SandboxError("timeout", `Cancelled: ${name}`, { retryable: true });
  state.calls.push(`${name}:${context.operationId}`);
};

const createSession = (
  providerId: string,
  providerSessionId: string,
  state: FakeRemoteSandboxState,
  capabilities: SandboxCapabilities,
  now: () => number,
): SandboxProviderSession => {
  const createdAt = now();
  const descriptor: SandboxSessionDescriptor = {
    sessionId: `session:${providerSessionId}`,
    providerId,
    providerSessionId,
    status: "ready",
    createdAt,
    updatedAt: createdAt,
  };
  const packages: Record<string, string> = {};

  const commandResult = (command: string): SandboxCommandRunResult => {
    const processId = `process:${state.processes.size + 1}`;
    const event = { type: "stdout" as const, text: `started ${command}\n`, timestamp: now() };
    state.processes.set(processId, {
      processId, command, cwd: "/", status: "running", outputTail: event.text,
      nextCursor: "1", updatedAt: now(), events: [event],
    });
    return {
      kind: "command", processId, command, cwd: "/", status: "running", completed: false,
      events: [event], nextCursor: "1", startedAt: now(), updatedAt: now(),
    };
  };

  return {
    descriptor,
    capabilities,
    runtime: {
      async run(request, context) {
        call(state, `runtime.${request.operation}`, context);
        if (request.operation === "command") return commandResult(request.command);
        const code = request.operation === "file"
          ? state.files.get(request.path) ?? ""
          : request.code;
        return {
          kind: request.operation, status: "ok", durationMs: 1, result: code,
          logs: [], truncatedLogs: 0,
          ...(request.operation === "file" ? { path: request.path } : {}),
          ...(request.operation === "repl" ? { replId: request.replId ?? "repl:default" } : {}),
        };
      },
    },
    processes: {
      async manage(request, context) {
        call(state, `process.${request.operation}`, context);
        if (request.operation === "list") {
          return { processes: [...state.processes.values()].map(({ events: _events, ...process }) => process) };
        }
        const process = state.processes.get(request.processId);
        if (!process) throw new SandboxError("process_not_found", `Unknown process: ${request.processId}`);
        if (request.operation === "stdin") {
          const event = { type: "stdout" as const, text: request.input, timestamp: now() };
          process.events.push(event);
          process.outputTail += request.input;
          process.nextCursor = String(process.events.length);
          return { processId: request.processId, sent: true };
        }
        if (request.operation === "stop") {
          process.status = "stopped";
          return { processId: request.processId, stopped: true };
        }
        const offset = Number.parseInt(request.cursor ?? "0", 10) || 0;
        const events = process.events.slice(offset);
        return {
          processId: request.processId, events, nextCursor: String(offset + events.length),
          status: process.status,
        };
      },
    },
    workspace: {
      async bind(manifest: SandboxWorkspaceManifest | undefined, context) {
        call(state, "workspace.bind", context);
        if (manifest?.mode !== "incremental") state.files.clear();
        for (const path of manifest?.deletedPaths ?? []) state.files.delete(path);
        for (const file of manifest?.files ?? []) state.files.set(file.path, file.content);
        return { changedPaths: manifest?.files.map((file) => file.path) ?? [], conflicts: [] };
      },
      async flush(context) {
        call(state, "workspace.flush", context);
        const changes = state.pendingWorkspaceChanges.splice(0);
        return { changedPaths: changes.flatMap((change) => change.operation === "rename" ? [change.oldPath, change.newPath] : [change.path]), conflicts: [], changes };
      },
    },
    packages: {
      async manage(request, context) {
        call(state, `packages.${request.operation}`, context);
        if (request.operation === "install") packages[request.packageSpec] = "1.0.0";
        if (request.operation === "install_from_package_json") packages.manifest = "1.0.0";
        return { success: true, packages: { ...packages } };
      },
    },
    previews: {
      async manage(request, context) {
        call(state, `preview.${request.operation}`, context);
        if (request.operation === "list") return { previews: [...state.previews.values()] };
        if (request.operation === "stop") {
          const previewId = request.previewId ?? [...state.previews.keys()][0];
          if (!previewId) throw new SandboxError("preview_not_found", "No preview is running");
          state.previews.delete(previewId);
          return { previewId, stopped: true };
        }
        if (request.operation === "request" || request.operation === "render") {
          const previewId = request.previewId ?? [...state.previews.keys()][0];
          if (!previewId) throw new SandboxError("preview_not_found", "No preview is running");
          return { previewId, url: `https://preview.invalid/${previewId}`, status: 200, ok: true, contentType: "text/html", responseType: "html", headers: {}, body: "<main>ready</main>" };
        }
        const startRequest = request as Extract<typeof request, { operation: "start" | "restart" }>;
        const previewId = `preview:${state.previews.size + 1}`;
        const preview: SandboxPreviewDescriptor = { previewId, kind: startRequest.kind === "auto" || !startRequest.kind ? "vite" : startRequest.kind, status: "running", port: startRequest.port ?? 4173, url: `https://preview.invalid/${previewId}`, rootDir: startRequest.projectDir };
        state.previews.set(previewId, preview);
        return preview;
      },
    },
    network: {
      async fetch(request, context) {
        call(state, "network.fetch", context);
        return { url: request.url, status: 200, ok: true, contentType: "application/json", responseType: "json", body: JSON.stringify({ ok: true }) };
      },
    },
    snapshots: {
      async manage(request, context): Promise<SandboxSnapshotResult> {
        call(state, `snapshot.${request.operation}`, context);
        if (request.operation === "create") {
          const snapshotId = `snapshot:${state.snapshots.size + 1}`;
          state.snapshots.set(snapshotId, new Map(state.files));
          return { snapshotId, label: request.label, createdAt: now() };
        }
        const snapshot = state.snapshots.get(request.snapshotId);
        if (!snapshot) throw new SandboxError("snapshot_not_found", `Unknown snapshot: ${request.snapshotId}`);
        state.files.clear();
        for (const [path, content] of snapshot) state.files.set(path, content);
        return { snapshotId: request.snapshotId, restored: true };
      },
    },
    async inspect(request, context): Promise<JsonValue> {
      call(state, `inspect.${request.operation}`, context);
      if (request.operation === "logs") {
        const result = { logs: state.logs.slice(-(request.limit ?? 100)).map((entry) => ({ ...entry })) };
        assertJsonValue(result, "fake sandbox logs");
        return result;
      }
      if (request.operation === "clear_logs") {
        state.logs.length = 0;
        return { cleared: true };
      }
      if (request.operation === "reset") {
        state.resetCount += 1;
        state.files.clear();
        state.processes.clear();
        state.previews.clear();
        return { reset: true };
      }
      return { ...descriptor, processCount: state.processes.size, previewCount: state.previews.size };
    },
    async reset(context) {
      call(state, "session.reset", context);
      state.resetCount += 1;
    },
    async close(context) {
      call(state, "session.close", context);
      state.closed = true;
      descriptor.status = "stopped";
    },
  };
};

export const createFakeRemoteSandboxProvider = (options: {
  readonly id?: string;
  readonly now?: () => number;
  readonly capabilities?: SandboxCapabilities;
} = {}): FakeRemoteSandboxProvider => {
  const state: FakeRemoteSandboxState = {
    calls: [], files: new Map(), processes: new Map(), previews: new Map(), snapshots: new Map(),
    logs: [], pendingWorkspaceChanges: [], closed: false, resetCount: 0,
  };
  const id = options.id ?? "fake-remote";
  const now = options.now ?? (() => Date.now());
  let sessions = 0;
  return {
    id,
    contractVersion: 1,
    state,
    async createSession(request: SandboxSessionRequest, context) {
      call(state, "session.create", context);
      sessions += 1;
      return createSession(id, `remote:${sessions}`, state, options.capabilities ?? DEFAULT_CAPABILITIES, now);
    },
    async reconnectSession(providerSessionId, context) {
      call(state, "session.reconnect", context);
      return createSession(id, providerSessionId, state, options.capabilities ?? DEFAULT_CAPABILITIES, now);
    },
  };
};

export const queueFakeWorkspaceChanges = (
  provider: FakeRemoteSandboxProvider,
  changes: readonly SandboxWorkspaceChange[],
): void => {
  provider.state.pendingWorkspaceChanges.push(...changes);
  for (const change of changes) {
    if (change.operation === "write") provider.state.files.set(change.path, change.content);
    else if (change.operation === "delete") provider.state.files.delete(change.path);
    else if (change.operation === "rename") {
      const content = provider.state.files.get(change.oldPath);
      provider.state.files.delete(change.oldPath);
      if (content !== undefined) provider.state.files.set(change.newPath, content);
    }
  }
};
