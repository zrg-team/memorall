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

/**
 * LangGraph's own step budget for a run of `maxIterations` agent turns.
 *
 * The two numbers count different things and are easy to mistake for each
 * other. `maxIterations` counts model turns; LangGraph counts super-steps —
 * every node it executes. One agent turn that calls a tool is two of those
 * (`agent`, then `tool_executor`), on top of the single `initial` step.
 *
 * Left unset, LangGraph applies its own default of 25 steps, which stops a run
 * after about twelve tool calls no matter what the agent was configured for:
 * the user sets 50, and the run dies on "Recursion limit of 25 reached" with
 * nothing in the UI to explain it. So the graph is given a budget derived from
 * the limit the user actually set, with a small margin so the agent's own
 * iteration guard is what ends the run and produces a real answer.
 */
export const recursionLimitForIterations = (maxIterations: number): number =>
	2 * normalizeAgentMaxIterations(maxIterations) + 4;
