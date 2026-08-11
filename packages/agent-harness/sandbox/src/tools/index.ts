import { z } from "zod";
import type { BaseTool } from "@memorall/agent-harness-core";
import {
  SANDBOX_SERVICE,
  type SandboxNetworkRequest,
  type SandboxPackageRequest,
  type SandboxPreviewRequest,
  type SandboxProcessRequest,
  type SandboxRunRequest,
  type SandboxSnapshotRequest,
} from "../contracts.js";
import {
  executeSandboxOperation,
  SANDBOX_TOOL_OUTPUT_SCHEMA,
  validateOperationFields,
} from "./tool-utils.js";

const inspectSchema = z.object({
  operation: z.enum(["status", "logs", "clear_logs", "reset"]),
  limit: z.number().int().min(1).max(500).optional(),
  level: z.enum(["log", "info", "warn", "error", "debug"]).optional(),
}).strict().superRefine((data, context) =>
  validateOperationFields(data, context, data.operation === "logs" ? ["limit", "level"] : []),
);

const runSchema = z.object({
  operation: z.enum(["code", "file", "command", "repl"]),
  code: z.string().min(1).optional(), path: z.string().min(1).optional(), filename: z.string().min(1).optional(),
  command: z.string().min(1).optional(), cwd: z.string().min(1).optional(), env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(10).max(120_000).optional(), waitTimeoutMs: z.number().int().min(0).max(120_000).optional(),
  commandTimeoutMs: z.number().int().min(10).max(600_000).optional(), maxLogEntries: z.number().int().min(1).max(500).optional(),
  replId: z.string().min(1).optional(),
}).strict().superRefine((data, context) => {
  const rules = {
    code: { allowed: ["code", "filename", "timeoutMs", "maxLogEntries"], required: ["code"] },
    file: { allowed: ["path", "timeoutMs", "maxLogEntries"], required: ["path"] },
    command: { allowed: ["command", "cwd", "env", "waitTimeoutMs", "commandTimeoutMs"], required: ["command"] },
    repl: { allowed: ["code", "replId", "timeoutMs"], required: ["code"] },
  } as const;
  const rule = rules[data.operation];
  validateOperationFields(data, context, rule.allowed, rule.required);
});

const processSchema = z.object({
  operation: z.enum(["list", "read", "stdin", "stop"]), processId: z.string().min(1).optional(),
  cursor: z.string().optional(), waitMs: z.number().int().min(0).max(120_000).optional(),
  maxChars: z.number().int().min(1).max(200_000).optional(), input: z.string().optional(), appendNewline: z.boolean().optional(),
}).strict().superRefine((data, context) => {
  const rules = {
    list: { allowed: [], required: [] }, read: { allowed: ["processId", "cursor", "waitMs", "maxChars"], required: ["processId"] },
    stdin: { allowed: ["processId", "input", "appendNewline"], required: ["processId", "input"] },
    stop: { allowed: ["processId"], required: ["processId"] },
  } as const;
  const rule = rules[data.operation];
  validateOperationFields(data, context, rule.allowed, rule.required);
});

const packageSchema = z.object({
  operation: z.enum(["install", "install_from_package_json", "list"]), packageSpec: z.string().min(1).optional(),
  save: z.boolean().optional(), saveDev: z.boolean().optional(),
}).strict().superRefine((data, context) => {
  const rules = {
    install: { allowed: ["packageSpec", "save", "saveDev"], required: ["packageSpec"] },
    install_from_package_json: { allowed: ["save", "saveDev"], required: [] }, list: { allowed: [], required: [] },
  } as const;
  const rule = rules[data.operation];
  validateOperationFields(data, context, rule.allowed, rule.required);
});

const previewSchema = z.object({
  operation: z.enum(["start", "restart", "stop", "list", "request", "render"]), projectDir: z.string().min(1).optional(),
  kind: z.enum(["express", "vite", "next", "auto"]).optional(), template: z.enum(["express", "vite-react", "next-pages", "next-app"]).optional(),
  port: z.number().int().min(1).max(65535).optional(), previewId: z.string().min(1).optional(), entryPath: z.string().min(1).optional(),
  hostname: z.string().min(1).optional(), path: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  headers: z.record(z.string(), z.string()).optional(), body: z.string().optional(), timeoutMs: z.number().int().min(10).max(120_000).optional(),
  responseType: z.enum(["auto", "json", "text", "html"]).optional(), maxChars: z.number().int().min(1).max(200_000).optional(),
}).strict().superRefine((data, context) => {
  const startFields = ["projectDir", "kind", "template", "port", "entryPath", "hostname"] as const;
  const requestFields = ["previewId", "port", "path", "method", "headers", "body", "timeoutMs", "responseType", "maxChars"] as const;
  const rules = {
    start: { allowed: startFields, required: ["projectDir"] }, restart: { allowed: startFields, required: ["projectDir"] },
    stop: { allowed: ["previewId", "port"], required: [] }, list: { allowed: [], required: [] },
    request: { allowed: requestFields, required: [] }, render: { allowed: requestFields, required: [] },
  } as const;
  const rule = rules[data.operation];
  validateOperationFields(data, context, rule.allowed, rule.required);
  if (["stop", "request", "render"].includes(data.operation) && data.previewId === undefined && data.port === undefined) {
    context.addIssue({ code: "custom", path: ["previewId"], message: "previewId or port is required" });
  }
});

const networkSchema = z.object({
  operation: z.literal("fetch"), url: z.string().url(), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
  headers: z.record(z.string(), z.string()).optional(), body: z.string().optional(), timeoutMs: z.number().int().min(10).max(120_000).optional(),
  responseType: z.enum(["auto", "json", "text", "html"]).optional(), maxChars: z.number().int().min(1).max(200_000).optional(),
}).strict();

const snapshotSchema = z.object({
  operation: z.enum(["create", "restore"]), label: z.string().min(1).max(120).optional(), snapshotId: z.string().min(1).optional(),
}).strict().superRefine((data, context) => {
  const rule = data.operation === "create"
    ? { allowed: ["label"], required: [] }
    : { allowed: ["snapshotId"], required: ["snapshotId"] };
  validateOperationFields(data, context, rule.allowed, rule.required);
});

const base = (name: string, title: string, description: string) => ({
  name, title, description, outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
  requiredServices: [SANDBOX_SERVICE], metadata: { category: "sandbox" as const },
});

export const createSandboxTools = (): Record<string, BaseTool<any>> => ({
  sandbox_inspect: {
    ...base("sandbox_inspect", "Inspect sandbox", "Inspect status or logs, clear logs, or reset the active sandbox."),
    schema: inspectSchema,
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_inspect", input.operation, context,
      (service, call) => service.inspect(input, call),
    ),
  },
  sandbox_run: {
    ...base("sandbox_run", "Run in sandbox", "Run code, a workspace file, a command, or persistent REPL code."),
    schema: runSchema,
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_run", input.operation, context,
      (service, call) => service.run(input as SandboxRunRequest, call),
    ),
  },
  sandbox_process: {
    ...base("sandbox_process", "Manage sandbox processes", "List, read, write stdin to, or stop sandbox processes using opaque cursors."),
    schema: processSchema,
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_process", input.operation, context,
      (service, call) => service.process(input as SandboxProcessRequest, call),
    ),
  },
  sandbox_packages: {
    ...base("sandbox_packages", "Manage sandbox packages", "Install packages, install package.json, or list resolved packages."),
    schema: packageSchema,
    annotations: { openWorldHint: true },
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_packages", input.operation, context,
      (service, call) => service.packages(input as SandboxPackageRequest, call),
    ),
  },
  sandbox_preview: {
    ...base("sandbox_preview", "Manage sandbox previews", "Start, restart, stop, list, request, or render sandbox previews."),
    schema: previewSchema,
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_preview", input.operation, context,
      (service, call) => service.preview(input as SandboxPreviewRequest, call),
      input.operation === "render" ? "web_access" : undefined,
    ),
  },
  sandbox_network: {
    ...base("sandbox_network", "Fetch from sandbox", "Fetch HTTP or HTTPS from inside the active sandbox."),
    schema: networkSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    execute: (input, context) => {
      const { operation: _operation, ...request } = input;
      return executeSandboxOperation(
        context.services.get(SANDBOX_SERVICE), "sandbox_network", input.operation, context,
        (service, call) => service.network(request as SandboxNetworkRequest, call),
      );
    },
  },
  sandbox_snapshot: {
    ...base("sandbox_snapshot", "Manage sandbox snapshots", "Capture or restore an opaque sandbox snapshot."),
    schema: snapshotSchema,
    execute: (input, context) => executeSandboxOperation(
      context.services.get(SANDBOX_SERVICE), "sandbox_snapshot", input.operation, context,
      (service, call) => service.snapshot(input as SandboxSnapshotRequest, call),
    ),
  },
});

export { SANDBOX_TOOL_OUTPUT_SCHEMA, validateOperationFields } from "./tool-utils.js";
