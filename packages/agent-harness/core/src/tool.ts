import { z } from "zod";
import { HarnessError, throwIfCancelled } from "./errors.js";
import type { JsonValue } from "./json.js";
import type { HarnessPlatform } from "./platform.js";
import type { RunContext } from "./runtime-context.js";
import type { ServiceResolver, ServiceToken } from "./services.js";

export type JsonSchema = Record<string, unknown>;

export interface JsonToolSchema<T = unknown> {
  readonly kind: "json-schema";
  readonly jsonSchema: JsonSchema;
  parse(input: unknown): T;
}

export type ToolSchema<T = unknown> = z.ZodType<T> | JsonToolSchema<T>;

export const jsonToolSchema = <T = unknown>(
  jsonSchema: JsonSchema,
  parse: (input: unknown) => T = (input) => input as T,
): JsonToolSchema<T> => ({ kind: "json-schema", jsonSchema, parse });

export const isJsonToolSchema = <T>(schema: ToolSchema<T>): schema is JsonToolSchema<T> =>
  typeof schema === "object" && schema !== null && "kind" in schema && schema.kind === "json-schema";

export const parseToolInput = <T>(schema: ToolSchema<T>, input: unknown): T => schema.parse(input);

export const toolSchemaToJsonSchema = (schema: ToolSchema): JsonSchema => {
  if (isJsonToolSchema(schema)) return schema.jsonSchema;
  const converter = (z as unknown as { toJSONSchema(value: z.ZodType): JsonSchema }).toJSONSchema;
  if (typeof converter !== "function") {
    throw new HarnessError("invalid_request", "The installed Zod version cannot emit JSON Schema");
  }
  return converter(schema);
};

export interface ToolExecutionMeta {
  operationId?: string;
  sessionId?: string;
  processId?: string;
  previewId?: string;
  snapshotId?: string;
  nextCursor?: string;
  durationMs?: number;
  truncated?: boolean;
  warnings?: readonly string[];
  [key: string]: JsonValue | undefined;
}

export interface ToolExecutionResult<T = JsonValue> {
  content: string;
  structuredContent?: T;
  isError?: boolean;
  meta?: ToolExecutionMeta;
}

export type ToolResultValue<T = JsonValue> = string | ToolExecutionResult<T>;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  parallelSafeHint?: boolean;
}

export interface ToolExecutionContext<TState = unknown> {
  readonly runId: string;
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
  readonly scope: Readonly<Record<string, string>>;
  readonly state: TState;
  readonly runtime: RunContext;
  readonly services: ServiceResolver;
  readonly platform: HarnessPlatform;
}

export interface BaseTool<TInput = unknown> {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly schema: ToolSchema<TInput>;
  readonly outputSchema?: JsonSchema;
  readonly icons?: readonly { src: string; mimeType?: string; sizes?: readonly string[] }[];
  readonly annotations?: ToolAnnotations;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly requiredServices?: readonly ServiceToken<unknown>[];
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResultValue>;
}

export type ToolFactory = (services: ServiceResolver) => BaseTool;

export const normalizeToolResult = (value: ToolResultValue): ToolExecutionResult =>
  typeof value === "string" ? { content: value } : value;

export interface ToolRetryPolicy {
  readonly maxRetries: number;
  readonly delayMs?: number;
}

export const executeTool = async (
  tool: BaseTool,
  input: unknown,
  context: ToolExecutionContext,
  retry: ToolRetryPolicy = { maxRetries: 0 },
): Promise<ToolExecutionResult> => {
  const parsed = parseToolInput(tool.schema, input);
  let attempt = 0;
  for (;;) {
    throwIfCancelled(context.signal, context.deadlineMs, () => context.platform.now());
    try {
      return normalizeToolResult(await tool.execute(parsed, context));
    } catch (error) {
      const canRetry =
        tool.annotations?.idempotentHint === true &&
        error instanceof HarnessError &&
        error.retryable &&
        attempt < retry.maxRetries;
      if (!canRetry) throw error;
      attempt += 1;
      if ((retry.delayMs ?? 0) > 0) {
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            context.signal.removeEventListener("abort", abort);
            resolve();
          };
          const scheduled = context.platform.schedule(retry.delayMs ?? 0, finish);
          const abort = () => {
            scheduled.cancel();
            reject(new HarnessError("cancelled", "Tool retry was cancelled"));
          };
          context.signal.addEventListener("abort", abort, { once: true });
        });
      }
    }
  }
};
