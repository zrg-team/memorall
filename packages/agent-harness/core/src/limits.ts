export interface HarnessLimits {
  maxIterations: number;
  maxConcurrentTools: number;
  maxBufferedEvents: number;
  maxToolOutputBytes: number;
  maxRunMs?: number;
}

export const DEFAULT_HARNESS_LIMITS: HarnessLimits = Object.freeze({
  maxIterations: 10,
  maxConcurrentTools: 1,
  maxBufferedEvents: 256,
  maxToolOutputBytes: 64 * 1024,
});

export const mergeHarnessLimits = (limits: Partial<HarnessLimits> = {}): HarnessLimits => {
  const merged = { ...DEFAULT_HARNESS_LIMITS, ...limits };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new RangeError(`Harness limit ${key} must be a positive finite number`);
    }
  }
  return Object.freeze(merged);
};
