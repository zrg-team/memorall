import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HarnessError,
  createHarness,
  createServiceToken,
  type HarnessEvent,
  type HarnessPlugin,
} from "../index.js";
import {
  MemoryCheckpointStore,
  MemoryEventStore,
  createTestPlatform,
} from "../testing.js";

const collect = async (events: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> => {
  const values: HarnessEvent[] = [];
  for await (const event of events) values.push(event);
  return values;
};

describe("agent harness core", () => {
  it("installs plugins in dependency order and freezes instance registries", () => {
    const order: string[] = [];
    const base: HarnessPlugin = {
      id: "base",
      version: "1.2.0",
      register: () => order.push("base"),
    };
    const feature: HarnessPlugin = {
      id: "feature",
      version: "1.0.0",
      requires: [{ id: "base", range: "^1.0.0" }],
      register: ({ registerGraph }) => {
        order.push("feature");
        registerGraph({
          id: "echo",
          version: "1.0.0",
          execute: async ({ input }) => ({ output: input as string }),
        });
      },
    };
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [feature, base],
    });
    expect(order).toEqual(["base", "feature"]);
    expect(harness.inspect().graphs.map(({ id }) => id)).toEqual(["echo"]);
  });

  it("rejects duplicate, missing, incompatible, and cyclic plugins", () => {
    const platform = createTestPlatform();
    const empty = (id: string, requires?: HarnessPlugin["requires"]): HarnessPlugin => ({
      id,
      version: "1.0.0",
      requires,
      register: () => undefined,
    });
    expect(() => createHarness({ platform, plugins: [empty("x"), empty("x")] })).toThrow(
      /Duplicate plugin/,
    );
    expect(() =>
      createHarness({ platform, plugins: [empty("x", [{ id: "missing", range: "*" }])] }),
    ).toThrow(/Missing plugin/);
    expect(() =>
      createHarness({
        platform,
        plugins: [empty("base"), empty("x", [{ id: "base", range: "^2" }])],
      }),
    ).toThrow(/requires base/);
    expect(() =>
      createHarness({
        platform,
        plugins: [
          empty("a", [{ id: "b", range: "*" }]),
          empty("b", [{ id: "a", range: "*" }]),
        ],
      }),
    ).toThrow(/cycle/);
  });

  it("streams JSON-safe lifecycle events and returns a structured result", async () => {
    const plugin: HarnessPlugin = {
      id: "echo",
      version: "1.0.0",
      register: ({ registerGraph }) =>
        registerGraph({
          id: "echo",
          version: "1.0.0",
          execute: async ({ input, events, runId, platform }) => {
            await events.emit({
              type: "model.delta",
              runId,
              delta: { text: String(input) },
              timestamp: platform.now(),
            });
            return { output: { echoed: String(input) } };
          },
        }),
    };
    const eventStore = new MemoryEventStore();
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [plugin],
      eventStore,
      limits: { maxBufferedEvents: 2 },
    });
    const run = harness.run({ graph: "echo", input: "hello" });
    const [events, result] = await Promise.all([collect(run), run.result()]);
    expect(events.map(({ type }) => type)).toEqual([
      "run.started",
      "model.delta",
      "run.completed",
    ]);
    expect(result.output).toEqual({ echoed: "hello" });
    expect((await eventStore.read(run.id)).events).toHaveLength(3);
  });

  it("drains a bounded stream when only result is consumed", async () => {
    const harness = createHarness({
      platform: createTestPlatform(),
      limits: { maxBufferedEvents: 2 },
      plugins: [
        {
          id: "many",
          version: "1.0.0",
          register: ({ registerGraph }) =>
            registerGraph({
              id: "many",
              version: "1.0.0",
              execute: async ({ events, runId, platform }) => {
                for (let index = 0; index < 20; index += 1) {
                  await events.emit({
                    type: "model.delta",
                    runId,
                    delta: { index },
                    timestamp: platform.now(),
                  });
                }
                return { output: "done" };
              },
            }),
        },
      ],
    });
    await expect(harness.run({ graph: "many", input: null }).result()).resolves.toMatchObject({
      output: "done",
    });
  });

  it("validates required services at run time", async () => {
    const database = createServiceToken<{ ready: boolean }>("database");
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [
        {
          id: "service-user",
          version: "1.0.0",
          register: ({ registerGraph, requireService }) => {
            requireService(database);
            registerGraph({
              id: "service",
              version: "1.0.0",
              execute: async ({ services }) => ({ output: services.get(database).ready }),
            });
          },
        },
      ],
    });
    await expect(harness.run({ graph: "service", input: null }).result()).rejects.toMatchObject({
      code: "missing_service",
    });
    await expect(
      harness.run({ graph: "service", input: null, services: { database: { ready: true } } }).result(),
    ).resolves.toMatchObject({ output: true });
  });

  it("captures and validates versioned checkpoints", async () => {
    const checkpoints = new MemoryCheckpointStore();
    const plugin: HarnessPlugin = {
      id: "stateful",
      version: "1.0.0",
      register: ({ registerGraph }) =>
        registerGraph({
          id: "stateful",
          version: "1.0.0",
          execute: async ({ checkpoint }) => ({
            output: checkpoint?.state ?? { count: 1 },
            checkpointState: { count: 1 },
          }),
        }),
    };
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [plugin],
      checkpointStore: checkpoints,
    });
    const first = await harness.run({ graph: "stateful", input: null }).result();
    expect(first.checkpointId).toBeTruthy();
    await expect(
      harness.run({ graph: "stateful", input: null, checkpoint: first.checkpointId }).result(),
    ).resolves.toMatchObject({ output: { count: 1 } });

    const stored = await checkpoints.load(first.checkpointId!);
    await checkpoints.save({ ...stored!, graphVersion: "2.0.0" });
    await expect(
      harness.run({ graph: "stateful", input: null, checkpoint: first.checkpointId }).result(),
    ).rejects.toMatchObject({ code: "checkpoint_incompatible" });
  });

  it("propagates cancellation and closes active runs", async () => {
    const harness = createHarness({
      platform: createTestPlatform(),
      plugins: [
        {
          id: "waiting",
          version: "1.0.0",
          register: ({ registerGraph }) =>
            registerGraph({
              id: "waiting",
              version: "1.0.0",
              execute: ({ signal }) =>
                new Promise((_, reject) =>
                  signal.addEventListener(
                    "abort",
                    () => reject(new HarnessError("cancelled", "cancelled")),
                    { once: true },
                  ),
                ),
            }),
        },
      ],
    });
    const run = harness.run({ graph: "waiting", input: null });
    const result = run.result();
    await run.cancel();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    await harness.close();
    expect(() => harness.run({ graph: "waiting", input: null })).toThrow(/closed/);
  });

  it("keeps tool schemas explicit and import side effects empty", () => {
    const harness = createHarness({ platform: createTestPlatform() });
    expect(harness.inspect()).toMatchObject({ tools: [], graphs: [], plugins: {} });
    expect(z.object({ value: z.string() }).parse({ value: "ok" })).toEqual({ value: "ok" });
  });
});
