import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import { MODEL_SERVICE, type HarnessPlugin, type ModelService } from "@memorall/agent-harness-core";
import { createFullHarness, fullHarnessPreset } from "../index.js";

describe("full facade", () => {
  it("builds a side-effect-free configurable preset", () => {
    expect(fullHarnessPreset({ langgraph: false, standard: false, sandbox: false })).toEqual([]);
    const harness = createFullHarness({ platform: createTestPlatform(), preset: { mcp: false } });
    const descriptor = harness.inspect();
    expect(descriptor.plugins).toMatchObject({ "agent-harness.langgraph": "0.1.0", "agent-harness.standard": "0.1.0", "agent-harness.sandbox": "0.1.0" });
    expect(descriptor.tools).toEqual(expect.arrayContaining(["fs_read", "sandbox_run"]));
    expect(descriptor.tools).not.toContain("sandbox_snapshot");
  });

  it("runs the same custom-tool flow through the public facade", async () => {
    const model: ModelService = {
      async *stream(request) {
        if (!request.messages.some(({ role }) => role === "tool")) {
          yield { type: "completed", message: { role: "assistant", content: "", toolCalls: [{ id: "call", name: "uppercase", arguments: '{"value":"portable"}' }] } };
        } else yield { type: "completed", message: { role: "assistant", content: "PORTABLE" } };
      },
    };
    const custom: HarnessPlugin = {
      id: "custom", version: "1.0.0",
      register: ({ registerTool }) => registerTool("uppercase", () => ({ name: "uppercase", description: "Uppercase", schema: z.object({ value: z.string() }), execute: async ({ value }) => value.toUpperCase() })),
    };
    const harness = createFullHarness({
      platform: createTestPlatform(), services: { [MODEL_SERVICE.id]: model },
      preset: { standard: false, sandbox: false, plugins: [custom] },
    });
    await expect(harness.run({ graph: "agent", input: { messages: [{ role: "user", content: "run" }], tools: ["uppercase"] } }).result()).resolves.toMatchObject({ output: { response: "PORTABLE" } });
  });
});
