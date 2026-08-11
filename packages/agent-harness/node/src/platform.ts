import { randomUUID } from "node:crypto";
import type { HarnessPlatform } from "@memorall/agent-harness-core";

export const createNodePlatform = (): HarnessPlatform => ({
  runtime: "node",
  now: () => Date.now(),
  randomUUID,
  schedule: (delayMs, callback) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return { cancel: () => clearTimeout(timer) };
  },
  fetch: globalThis.fetch,
});
