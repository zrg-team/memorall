export interface CancelHandle {
  cancel(): void;
}

export interface HarnessPlatform {
  readonly runtime: "browser" | "worker" | "node" | string;
  now(): number;
  randomUUID(): string;
  schedule(delayMs: number, callback: () => void): CancelHandle;
  fetch?: typeof globalThis.fetch;
}
