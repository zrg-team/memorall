import { beforeAll, describe, expect, it } from "vitest";
import { stepRegistry } from "../registries/step-registry.js";
import { toolRegistry } from "../registries/tool-registry.js";
import {
  expectStepContracts,
  expectToolContracts,
  sortedDelta,
} from "./contract-test-utils.js";

describe("Memorall flow registered contracts", () => {
  let toolNames: string[] = [];
  let stepNames: string[] = [];

  beforeAll(async () => {
    const beforeTools = new Set(toolRegistry.getRegisteredToolNames());
    const beforeSteps = new Set(stepRegistry.getRegisteredStepNames());
    await import("../index");
    toolNames = sortedDelta(beforeTools, toolRegistry.getRegisteredToolNames());
    stepNames = sortedDelta(beforeSteps, stepRegistry.getRegisteredStepNames());
  });

  it("registers every core tool contract", () => {
    expect(toolNames).toMatchSnapshot();
    expectToolContracts(toolNames);
  });

  it("registers every core step contract", () => {
    expect(stepNames).toMatchSnapshot();
    expectStepContracts(stepNames);
  });
});
