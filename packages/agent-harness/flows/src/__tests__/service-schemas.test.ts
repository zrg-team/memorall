import { beforeAll, describe, expect, it } from "vitest";
import { serviceRegistry } from "../registries/service-registry.js";

/**
 * The schemas used to be registered as a side effect of each service interface
 * file, which put a cycle between `interfaces` and `registries`. They live in
 * `registries/service-schemas.ts` now. Nothing in the step or tool contract
 * snapshots covers them, and the Flow Builder's service catalog is built from
 * `serviceRegistry.getAll()` — so an ordering mistake here would empty that list
 * silently. This is the guard.
 */
describe("built-in service schemas", () => {
  beforeAll(async () => {
    await import("../index.js");
  });

  it("registers every built-in service by importing the package", () => {
    const names = serviceRegistry.getAll().map((entry) => entry.name).sort();
    expect(names).toEqual([
      "Agent Sandbox Runtime",
      "Filesystem",
      "Flow Catalog Service",
      "LLM",
      "Logger",
      "Sandbox Container",
      "Skill Service",
      "Web Browser",
    ]);
  });

  it("registers them from the registries barrel alone", async () => {
    await import("../registries/index.js");
    expect(serviceRegistry.getAll().length).toBeGreaterThanOrEqual(8);
  });
});
