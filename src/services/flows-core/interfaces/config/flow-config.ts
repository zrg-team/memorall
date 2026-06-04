/**
 * Unified Flow Configuration
 *
 * A single, self-contained config shape that drives every graph in the system.
 * All behavioral knobs (system prompt, tools, retrieval, features, citations)
 * are expressed as step instances with their own config and enabled flag.
 *
 * Design constraints:
 * - Step `id` is the unique identifier — duplicate `name` values are allowed
 *   (e.g., two "add-system" steps, each with different content).
 * - `steps` order defines execution order in the graph.
 * - No top-level fields beyond `graphType` and `steps` — avoids the proliferation
 *   of ad-hoc flags (enableContextRetrieval, enableCitations, featureFlags, …)
 *   that plagued the old FoundationConfig shape.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * A single step instance within a flow.
 * Multiple instances of the same step name are valid and run sequentially.
 */
export interface StepInstanceConfig {
	/** Stable identifier that uniquely identifies this slot in the flow. */
	id: string;
	/** Registry name of the step (e.g. "add-system", "context-smart-retrieve"). */
	name: string;
	/** Whether this step participates in the current execution. */
	enabled: boolean;
	/**
	 * Step-specific config values keyed by the param names declared in
	 * the step's StepMeta.configParams.
	 * Fields that map from state are declared in StepMeta.defaultStateMapping
	 * and are NOT repeated here.
	 */
	config?: Record<string, unknown>;
}

/**
 * The unified, graph-agnostic flow configuration.
 * Replaces FoundationConfig / FoundationPredefinedConfig and the
 * separate featureFlags record that used to be passed alongside it.
 */
export interface UnifiedFlowConfig {
	/** Selects which registered graph type runs this flow. */
	graphType: string;
	/**
	 * Ordered list of step instances.
	 * The graph chains enabled steps in array order: step[0] → step[1] → … → END.
	 */
	steps: StepInstanceConfig[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return only the enabled steps from a config, preserving order. */
export function getEnabledSteps(
	config: UnifiedFlowConfig,
): StepInstanceConfig[] {
	return config.steps.filter((s) => s.enabled);
}

/** Find a step instance by its unique id. */
export function findStepById(
	config: UnifiedFlowConfig,
	id: string,
): StepInstanceConfig | undefined {
	return config.steps.find((s) => s.id === id);
}

/** Find the first step instance with the given name. */
export function findStepByName(
	config: UnifiedFlowConfig,
	name: string,
): StepInstanceConfig | undefined {
	return config.steps.find((s) => s.name === name);
}

/** Find the first enabled step instance with the given name. */
export function findEnabledStepByName(
	config: UnifiedFlowConfig,
	name: string,
): StepInstanceConfig | undefined {
	return config.steps.find((s) => s.enabled && s.name === name);
}

/**
 * Return a new config with the step identified by `id` updated.
 * Pure — does not mutate the original.
 */
export function updateStepById(
	config: UnifiedFlowConfig,
	id: string,
	patch: Partial<StepInstanceConfig>,
): UnifiedFlowConfig {
	return {
		...config,
		steps: config.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
	};
}
