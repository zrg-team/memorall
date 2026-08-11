import {
  assertJsonValue,
  type JsonValue,
  type ToolExecutionContext,
  type ToolExecutionMeta,
  type ToolExecutionResult,
} from "@memorall/agent-harness-core";
import {
  SandboxError,
  type IAgentSandboxService,
  type SandboxCallContext,
} from "../contracts.js";
import type { RefinementCtx } from "zod";

export const validateOperationFields = (
  data: Record<string, unknown>,
  context: RefinementCtx,
  allowed: readonly string[],
  required: readonly string[] = [],
): void => {
  const permitted = new Set(["operation", ...allowed]);
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && !permitted.has(key)) {
      context.addIssue({ code: "custom", path: [key], message: `${key} is not valid for ${String(data.operation)}` });
    }
  }
  for (const key of required) {
    if (data[key] === undefined) context.addIssue({ code: "custom", path: [key], message: `${key} is required` });
  }
};

const metadataFrom = (value: unknown): ToolExecutionMeta => {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const meta: ToolExecutionMeta = {};
  for (const key of ["sessionId", "processId", "previewId", "snapshotId", "nextCursor"] as const) {
    if (typeof record[key] === "string") meta[key] = record[key];
  }
  if (typeof record.truncated === "boolean") meta.truncated = record.truncated;
  return meta;
};

export const sandboxCallContext = (
  context: ToolExecutionContext,
  operation: string,
): SandboxCallContext => ({
  operationId: context.operationId || `${operation}:${context.platform.randomUUID()}`,
  sessionKey: context.scope.conversationId ?? context.scope.sessionKey ?? "default",
  signal: context.signal,
  deadlineMs: context.deadlineMs,
});

export const executeSandboxOperation = async (
  service: IAgentSandboxService,
  tool: string,
  operation: string,
  context: ToolExecutionContext,
  execute: (service: IAgentSandboxService, call: SandboxCallContext) => Promise<unknown>,
  actionType?: string,
): Promise<ToolExecutionResult> => {
  const startedAt = context.platform.now();
  try {
    const value = await execute(service, sandboxCallContext(context, `${tool}.${operation}`));
    const structured = { ok: true, operation, ...(actionType ? { actionType } : {}), result: value };
    assertJsonValue(structured, `${tool} result`);
    return {
      content: JSON.stringify(structured),
      structuredContent: structured,
      meta: {
        operationId: context.operationId,
        durationMs: Math.max(0, context.platform.now() - startedAt),
        ...metadataFrom(value),
      },
    };
  } catch (error) {
    const normalized = error instanceof SandboxError
      ? { code: error.code, message: error.message, retryable: error.retryable }
      : { code: "provider_error", message: error instanceof Error ? error.message : String(error), retryable: false };
    const structured = { ok: false, operation, error: normalized };
    assertJsonValue(structured, `${tool} error`);
    return {
      content: JSON.stringify(structured),
      structuredContent: structured,
      isError: true,
      meta: {
        operationId: context.operationId,
        durationMs: Math.max(0, context.platform.now() - startedAt),
      },
    };
  }
};

export const SANDBOX_TOOL_OUTPUT_SCHEMA: Record<string, JsonValue> = {
  type: "object",
  required: ["ok", "operation"],
};
