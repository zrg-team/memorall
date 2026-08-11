import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import {
  HarnessError,
  assertJsonValue,
  throwIfCancelled,
  type HarnessGraphDefinition,
  type HarnessStepDefinition,
  type JsonValue,
} from "@memorall/agent-harness-core";

export interface LinearGraphOptions {
  id?: string;
  version?: string;
  description?: string;
  steps: readonly string[];
}

const LinearState = Annotation.Root({
  value: Annotation<JsonValue>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export const createLinearGraph = (options: LinearGraphOptions): HarnessGraphDefinition => ({
  id: options.id ?? "linear",
  version: options.version ?? "1.0.0",
  description: options.description ?? "Ordered LangGraph step pipeline",
  execute: async (context) => {
    const initial = context.checkpoint?.state ?? context.input;
    assertJsonValue(initial, "Linear graph input");
    const steps: HarnessStepDefinition[] = options.steps.map((id) => {
      const step = context.steps.get(id);
      if (!step) throw new HarnessError("invalid_request", `Step is not registered: ${id}`);
      return step;
    });
    const workflow = new StateGraph(LinearState)
      .addNode("linear", async ({ value }) => {
        let current = value;
        for (const step of steps) {
          throwIfCancelled(context.signal, context.deadlineMs, () => context.platform.now());
          for (const token of step.requiredServices ?? []) context.services.get(token);
          const startedAt = context.platform.now();
          await context.events.emit({
            type: "node.started",
            runId: context.runId,
            nodeId: step.id,
            timestamp: startedAt,
          });
          current = await step.execute({ ...context, input: current });
          const completedAt = context.platform.now();
          await context.events.emit({
            type: "node.completed",
            runId: context.runId,
            nodeId: step.id,
            timestamp: completedAt,
            durationMs: Math.max(0, completedAt - startedAt),
          });
        }
        return { value: current };
      })
      .addEdge(START, "linear")
      .addEdge("linear", END)
      .compile();
    const result = await workflow.invoke({ value: initial });
    return { output: result.value, checkpointState: result.value };
  },
});
