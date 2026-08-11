import {
  assertJsonValue,
  createServiceToken,
  type HarnessPlugin,
  type JsonValue,
} from "@memorall/agent-harness-core";

export interface CompactionRequest {
  state: JsonValue;
  maxTokens?: number;
  signal: AbortSignal;
}

export interface ContextCompactionService {
  compact(request: CompactionRequest): Promise<JsonValue>;
}

export const COMPACTION_SERVICE = createServiceToken<ContextCompactionService>("contextCompaction", {
  description: "Context compaction strategy",
});

export const compactionPlugin = (options: { maxTokens?: number } = {}): HarnessPlugin => ({
  id: "agent-harness.standard.compaction",
  version: "0.1.0",
  register: ({ registerStep }) => {
    registerStep({
      id: "auto-compact",
      version: "1.0.0",
      description: "Compact graph state through an injected policy",
      requiredServices: [COMPACTION_SERVICE],
      execute: async ({ input, services, signal }) => {
        assertJsonValue(input, "compaction input");
        return services.get(COMPACTION_SERVICE).compact({
          state: input,
          maxTokens: options.maxTokens,
          signal,
        });
      },
    });
  },
});
