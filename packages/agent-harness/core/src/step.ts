import type { HarnessEventSink } from "./events.js";
import type { JsonValue } from "./json.js";
import type { HarnessLimits } from "./limits.js";
import type { RunLifecycle } from "./lifecycle.js";
import type { HarnessPlatform } from "./platform.js";
import type { RunContext } from "./runtime-context.js";
import type { ServiceResolver, ServiceToken } from "./services.js";
import type { ToolRegistry } from "./registries.js";

export interface HarnessStepContext {
  readonly runId: string;
  readonly input: JsonValue;
  readonly scope: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly deadlineMs?: number;
  readonly services: ServiceResolver;
  readonly platform: HarnessPlatform;
  readonly events: HarnessEventSink;
  readonly lifecycle: RunLifecycle;
  readonly runtime: RunContext;
  readonly limits: HarnessLimits;
  readonly tools: ToolRegistry;
}

export interface HarnessStepDefinition {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly requiredServices?: readonly ServiceToken<unknown>[];
  execute(context: HarnessStepContext): Promise<JsonValue>;
}
