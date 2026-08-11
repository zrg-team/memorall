import type { HarnessEventSink } from "./events.js";
import type { JsonValue } from "./json.js";
import type { HarnessLimits } from "./limits.js";
import type { RunLifecycle } from "./lifecycle.js";
import type { HarnessCheckpoint } from "./persistence.js";
import type { HarnessPlatform } from "./platform.js";
import type { RunContext } from "./runtime-context.js";
import type { ServiceResolver, ServiceToken } from "./services.js";
import type { StepRegistry, ToolRegistry } from "./registries.js";

export interface HarnessGraphExecutionResult {
  output: JsonValue;
  checkpointState?: JsonValue;
  providerContinuations?: Readonly<Record<string, string>>;
}

export interface HarnessGraphExecutionContext {
  readonly runId: string;
  readonly input: unknown;
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
  readonly steps: StepRegistry;
  readonly checkpoint?: HarnessCheckpoint;
}

export interface HarnessGraphDefinition {
  readonly id: string;
  readonly version: string;
  readonly description?: string;
  readonly requiredServices?: readonly ServiceToken<unknown>[];
  execute(context: HarnessGraphExecutionContext): Promise<HarnessGraphExecutionResult>;
}
