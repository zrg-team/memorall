import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createHarness } from "@memorall/agent-harness-core";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import {
  LEGACY_CONTAINER_TOOL_IDS,
  LEGACY_GRAPH_IDS,
  LEGACY_STEP_IDS,
  compatibilityPlugin,
} from "../index.js";

describe("compatibility bridge", () => {
  it("declares stable legacy IDs and registers only host-supplied implementations", () => {
    expect(LEGACY_GRAPH_IDS).toEqual(["foundation", "agent"]);
    expect(LEGACY_STEP_IDS).toContain("nodejs-sandbox-feature");
    expect(LEGACY_CONTAINER_TOOL_IDS).toContain("container_run_code");
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [compatibilityPlugin({
        graphs: [{ id: "foundation", version: "legacy", execute: async ({ input }) => ({ output: String(input) }) }],
        steps: [{ id: "add-system", version: "legacy", execute: async ({ input }) => input as null }],
        tools: { container_run_code: () => ({ name: "container_run_code", description: "legacy", schema: z.object({ code: z.string() }), execute: async ({ code }) => code }) },
      })],
    });
    expect(harness.inspect()).toMatchObject({ graphs: [{ id: "foundation" }], steps: [{ id: "add-system" }], tools: ["container_run_code"] });
  });
});
