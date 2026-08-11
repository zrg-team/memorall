import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HarnessError,
  MODEL_SERVICE,
  createHarness,
  type HarnessEvent,
  type HarnessPlugin,
  type ModelRequest,
  type ModelService,
  type ModelStreamEvent,
} from "@memorall/agent-harness-core";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import { langGraphPlugin } from "../index.js";

const collect = async (run: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> => {
  const output: HarnessEvent[] = [];
  for await (const event of run) output.push(event);
  return output;
};

class ScriptedModel implements ModelService {
  readonly requests: ModelRequest[] = [];
  constructor(private readonly scripts: readonly (readonly ModelStreamEvent[])[]) {}
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    for (const event of this.scripts[this.requests.length - 1] ?? []) yield event;
  }
}

const completed = (content: string, toolCalls?: readonly { id: string; name: string; arguments: string }[]): ModelStreamEvent => ({
  type: "completed",
  message: { role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) },
});

describe("LangGraph harness adapter", () => {
  it("runs a complete streamed tool loop and preserves structured results", async () => {
    const model = new ScriptedModel([
      [
        { type: "tool.delta", index: 0, id: "call-1", name: "echo", arguments: '{"value":' },
        { type: "tool.delta", index: 0, arguments: '"hello"}' },
        { type: "usage", inputTokens: 5, outputTokens: 2, totalTokens: 7 },
        completed("", [{ id: "call-1", name: "echo", arguments: '{"value":"hello"}' }]),
      ],
      [{ type: "text.delta", text: "done" }, completed("done")],
    ]);
    const tools: HarnessPlugin = {
      id: "test.tools", version: "1.0.0",
      register: ({ registerTool }) => registerTool("echo", () => ({
        name: "echo", description: "Echo", schema: z.object({ value: z.string() }),
        annotations: { idempotentHint: true, parallelSafeHint: true },
        execute: async ({ value }, context) => ({ content: value, structuredContent: { value }, meta: { operationId: context.operationId } }),
      })),
    };
    const harness = createHarness({
      platform: createTestPlatform(), plugins: [langGraphPlugin(), tools],
      services: { [MODEL_SERVICE.id]: model },
    });
    const run = harness.run({ graph: "agent", input: { messages: [{ role: "user", content: "echo" }], tools: ["echo"] } });
    const [events, result] = await Promise.all([collect(run), run.result()]);
    expect(result.output).toMatchObject({ response: "done", usage: { totalTokens: 7 } });
    expect(events.map(({ type }) => type)).toContain("tool.completed");
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "call-1" });
  });

  it("retries only idempotent retryable tools with one operation ID", async () => {
    const model = new ScriptedModel([
      [completed("", [{ id: "stable-id", name: "retry", arguments: "{}" }])],
      [completed("ok")],
    ]);
    let attempts = 0;
    const operationIds: string[] = [];
    const plugin: HarnessPlugin = {
      id: "retry.tool", version: "1.0.0",
      register: ({ registerTool }) => registerTool("retry", () => ({
        name: "retry", description: "Retry", schema: z.object({}), annotations: { idempotentHint: true },
        execute: async (_input, context) => {
          attempts += 1;
          operationIds.push(context.operationId);
          if (attempts === 1) throw new HarnessError("transport_error", "temporary", { retryable: true });
          return "ok";
        },
      })),
    };
    const harness = createHarness({ platform: createTestPlatform(), plugins: [langGraphPlugin({ agent: { maxRetries: 1 } }), plugin], services: { llm: model } });
    await harness.run({ graph: "agent", input: { messages: [], tools: ["retry"] } }).result();
    expect(attempts).toBe(2);
    expect(operationIds).toEqual(["stable-id", "stable-id"]);
  });

  it("enables parallel model calls only when every selected tool is parallel-safe", async () => {
    const scripts = [[completed("done")]];
    const safeModel = new ScriptedModel(scripts);
    const unsafeModel = new ScriptedModel(scripts);
    const plugin: HarnessPlugin = {
      id: "parallel.tools", version: "1.0.0",
      register: ({ registerTool }) => {
        registerTool("safe", () => ({ name: "safe", description: "safe", schema: z.object({}), annotations: { parallelSafeHint: true }, execute: async () => "safe" }));
        registerTool("unsafe", () => ({ name: "unsafe", description: "unsafe", schema: z.object({}), execute: async () => "unsafe" }));
      },
    };
    const safe = createHarness({ platform: createTestPlatform(), plugins: [langGraphPlugin(), plugin], services: { llm: safeModel }, limits: { maxConcurrentTools: 2 } });
    await safe.run({ graph: "agent", input: { messages: [], tools: ["safe"] } }).result();
    expect(safeModel.requests[0]!.parallelToolCalls).toBe(true);
    const unsafe = createHarness({ platform: createTestPlatform(), plugins: [langGraphPlugin(), plugin], services: { llm: unsafeModel }, limits: { maxConcurrentTools: 2 } });
    await unsafe.run({ graph: "agent", input: { messages: [], tools: ["safe", "unsafe"] } }).result();
    expect(unsafeModel.requests[0]!.parallelToolCalls).toBe(false);
  });

  it("bounds tool output and fails deterministically at the iteration limit", async () => {
    const truncating = new ScriptedModel([
      [completed("", [{ id: "large", name: "large", arguments: "{}" }])],
      [completed("done")],
    ]);
    const tool: HarnessPlugin = {
      id: "large.tool", version: "1.0.0",
      register: ({ registerTool }) => registerTool("large", () => ({ name: "large", description: "large", schema: z.object({}), execute: async () => "x".repeat(1_000) })),
    };
    const harness = createHarness({ platform: createTestPlatform(), plugins: [langGraphPlugin(), tool], services: { llm: truncating }, limits: { maxToolOutputBytes: 50 } });
    const run = harness.run({ graph: "agent", input: { messages: [], tools: ["large"] } });
    const [events] = await Promise.all([collect(run), run.result()]);
    const completedTool = events.find((event) => event.type === "tool.completed");
    expect(completedTool?.type === "tool.completed" && completedTool.result.meta?.truncated).toBe(true);

    const looping = new ScriptedModel([[completed("", [{ id: "1", name: "large", arguments: "{}" }])]]);
    const limited = createHarness({ platform: createTestPlatform(), plugins: [langGraphPlugin(), tool], services: { llm: looping }, limits: { maxIterations: 1 } });
    await expect(limited.run({ graph: "agent", input: { messages: [], tools: ["large"] } }).result()).rejects.toMatchObject({ code: "resource_limit" });
  });

  it("executes ordered linear steps and emits engine-neutral node events", async () => {
    const steps: HarnessPlugin = {
      id: "test.steps", version: "1.0.0",
      register: ({ registerStep }) => {
        registerStep({ id: "increment", version: "1.0.0", execute: async ({ input }) => Number(input) + 1 });
        registerStep({ id: "double", version: "1.0.0", execute: async ({ input }) => Number(input) * 2 });
      },
    };
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [langGraphPlugin({ agent: false, linear: { id: "pipeline", steps: ["increment", "double"] } }), steps],
    });
    const run = harness.run({ graph: "pipeline", input: 2 });
    const [events, result] = await Promise.all([collect(run), run.result()]);
    expect(result.output).toBe(6);
    expect(events.filter(({ type }) => type === "node.started").map((event) => "nodeId" in event && event.nodeId)).toEqual(["increment", "double"]);
  });
});
