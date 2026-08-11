import {
  assertJsonValue,
  type HarnessPlugin,
  type ModelMessage,
} from "@memorall/agent-harness-core";

export interface AddSystemStepOptions {
  content?: string;
}

const messagesFrom = (input: unknown): ModelMessage[] => {
  if (!input || typeof input !== "object" || !Array.isArray((input as { messages?: unknown }).messages)) {
    return [];
  }
  return [...(input as { messages: ModelMessage[] }).messages];
};

export const chatPlugin = (options: AddSystemStepOptions = {}): HarnessPlugin => ({
  id: "agent-harness.standard.chat",
  version: "0.1.0",
  register: ({ registerStep }) => {
    registerStep({
      id: "add-system",
      version: "1.0.0",
      description: "Prepend a system message to a conversation",
      execute: async ({ input }) => {
        const record = input && typeof input === "object" && !Array.isArray(input) ? input : {};
        const inline = typeof (record as { content?: unknown }).content === "string"
          ? (record as { content: string }).content
          : undefined;
        const content = inline ?? options.content;
        const output = {
          ...(record as Record<string, unknown>),
          messages: content?.trim()
            ? [{ role: "system" as const, content }, ...messagesFrom(input)]
            : messagesFrom(input),
        };
        assertJsonValue(output, "add-system output");
        return output;
      },
    });
    registerStep({
      id: "current-time",
      version: "1.0.0",
      description: "Add the host clock value to run context",
      execute: async ({ input, platform, runtime }) => {
        const iso = new Date(platform.now()).toISOString();
        runtime.set("currentTime", iso);
        const output = { ...(input as Record<string, unknown>), currentTime: iso };
        assertJsonValue(output, "current-time output");
        return output;
      },
    });
  },
});
