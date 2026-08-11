import type { HarnessPlatform } from "@memorall/agent-harness-core";

export interface BrowserPlatformOptions {
  readonly runtime?: "browser" | "worker" | string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}

export const createBrowserPlatform = (options: BrowserPlatformOptions = {}): HarnessPlatform => ({
  runtime: options.runtime ?? (typeof document === "undefined" ? "worker" : "browser"),
  now: options.now ?? (() => Date.now()),
  randomUUID: options.randomUUID ?? (() => crypto.randomUUID()),
  schedule: (delayMs, callback) => {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer) };
  },
  fetch: options.fetch ?? globalThis.fetch,
});
