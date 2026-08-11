import type { JsonValue } from "./json.js";

export type HarnessErrorCode =
  | "cancelled"
  | "checkpoint_incompatible"
  | "deadline_exceeded"
  | "duplicate_registration"
  | "graph_not_found"
  | "invalid_request"
  | "missing_plugin"
  | "missing_service"
  | "plugin_cycle"
  | "plugin_version_mismatch"
  | "resource_limit"
  | "runtime_closed"
  | "tool_failed"
  | "tool_not_found"
  | "transport_error"
  | "unknown";

export interface SerializedHarnessError {
  code: HarnessErrorCode;
  message: string;
  retryable: boolean;
  details?: JsonValue;
}

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly retryable: boolean;
  readonly details?: JsonValue;

  constructor(
    code: HarnessErrorCode,
    message: string,
    options: { retryable?: boolean; details?: JsonValue; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HarnessError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export const serializeHarnessError = (error: unknown): SerializedHarnessError => {
  if (error instanceof HarnessError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
};

export const throwIfCancelled = (
  signal: AbortSignal,
  deadlineMs: number | undefined,
  now: () => number,
): void => {
  if (signal.aborted) {
    throw new HarnessError("cancelled", "Harness run was cancelled", {
      details: { reason: String(signal.reason ?? "cancelled") },
    });
  }
  if (deadlineMs !== undefined && now() > deadlineMs) {
    throw new HarnessError("deadline_exceeded", "Harness run deadline exceeded", {
      retryable: true,
    });
  }
};
