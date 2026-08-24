export const DEFAULT_AGENT_MAX_ITERATIONS = 50;
export const MIN_AGENT_MAX_ITERATIONS = 1;
export const MAX_AGENT_MAX_ITERATIONS = 200;

export const normalizeAgentMaxIterations = (value: unknown): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_AGENT_MAX_ITERATIONS;
	}

	return Math.min(
		MAX_AGENT_MAX_ITERATIONS,
		Math.max(MIN_AGENT_MAX_ITERATIONS, Math.trunc(value)),
	);
};
