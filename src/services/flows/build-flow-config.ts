/**
 * Flow Config Builder
 *
 * Provides two public functions:
 *
 *   buildDefaultFlowConfig(graphType)
 *     Returns the canonical default UnifiedFlowConfig for a graph type.
 *     Steps are ordered by the GRAPH_STEP_ORDER table; their config slots are
 *     pre-filled with the defaults declared in each step's StepMeta.
 *
 *   mergeWithDefaultConfig(saved, graphType)
 *     Overlays a persisted (potentially partial) config onto the canonical
 *     default.  Steps added to the catalog after a config was saved will
 *     appear with their defaults automatically — no migration needed.
 *
 * Design note: the canonical step ordering for each graph type lives in the
 * graph's own file alongside its flowRegistry.register() call.  Adding a new
 * graph type requires no changes here.
 */

import { stepRegistry } from "./step-registry";
import { getFeatureCatalogSteps } from "./flow-builder-catalog";
import { flowRegistry, FEATURE_SLOT } from "./flow-registry";
import type {
	UnifiedFlowConfig,
	StepInstanceConfig,
} from "./interfaces/flow-config";

// ---------------------------------------------------------------------------
// Graph type helpers
// ---------------------------------------------------------------------------

export type FlowGraphType = string;

const DEFAULT_GRAPH_TYPE: FlowGraphType = "foundation";

function isFlowGraphType(value: string): value is FlowGraphType {
	return flowRegistry.hasFlow(value);
}

export function normalizeFlowGraphType(
	graphType: string | undefined,
): FlowGraphType {
	return graphType && isFlowGraphType(graphType)
		? graphType
		: DEFAULT_GRAPH_TYPE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultStepId(
	graphType: FlowGraphType,
	name: string,
	occurrence: number,
): string {
	const safeName = name.replace(/[^a-z0-9_-]/gi, "_");
	return `${graphType}__${safeName}__${occurrence}`;
}

/** Build the initial config value for a step slot. */
function buildStepInstance(
	name: string,
	graphType: FlowGraphType,
	occurrence: number,
): StepInstanceConfig {
	const meta = stepRegistry.getMeta(name);
	const config: Record<string, unknown> = {};

	for (const param of meta?.configParams ?? []) {
		if (param.default !== undefined) {
			config[param.key] = param.default;
		}
	}

	Object.assign(config, flowRegistry.getStepDefaults(graphType, name));

	return {
		id: createDefaultStepId(graphType, name, occurrence),
		name,
		enabled: meta?.enabledByDefault ?? false,
		config: Object.keys(config).length > 0 ? config : undefined,
	};
}

/** Resolve the ordered step names for a graph type, inserting feature steps. */
function resolveStepOrder(graphType: FlowGraphType): string[] {
	const slots = flowRegistry.getStepOrder(graphType);

	// Volatile features (e.g. current-time) go last so the stable prefix
	// before them can be reused by the LLM provider's prompt cache.
	const featureSteps = getFeatureCatalogSteps().filter(
		(s) => !s.graphTypes || s.graphTypes.includes(graphType),
	);
	const featureNames = [
		...featureSteps
			.filter((s) => !(s.metadata as { volatile?: boolean }).volatile)
			.map((s) => s.name),
		...featureSteps
			.filter((s) => (s.metadata as { volatile?: boolean }).volatile)
			.map((s) => s.name),
	];

	const injectableMap = stepRegistry.getInjectableSteps();

	const result: string[] = [];
	for (const slot of slots) {
		if (slot === FEATURE_SLOT) {
			result.push(...featureNames);
		} else {
			result.push(slot);
			// Inject any steps that declared injectAfter this slot
			const toInject = injectableMap.get(slot) ?? [];
			for (const name of toInject) {
				if (!result.includes(name)) {
					result.push(name);
				}
			}
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the canonical default UnifiedFlowConfig for a graph type.
 *
 * Only steps that are registered in the step registry are included —
 * steps present in the order table but not yet registered are skipped
 * gracefully (supports lazy loading / partial builds in tests).
 */
export function buildDefaultFlowConfig(graphType: string): UnifiedFlowConfig {
	const normalizedGraphType = normalizeFlowGraphType(graphType);
	const orderedNames = resolveStepOrder(normalizedGraphType);
	const stepCounts = new Map<string, number>();

	const steps: StepInstanceConfig[] = orderedNames
		.filter((name) => stepRegistry.hasStep(name))
		.map((name) => {
			const occurrence = (stepCounts.get(name) ?? 0) + 1;
			stepCounts.set(name, occurrence);
			return buildStepInstance(name, normalizedGraphType, occurrence);
		});

	return { graphType: normalizedGraphType, steps };
}

/**
 * Merge a persisted (potentially partial or stale) config onto the
 * canonical default for the given graph type.
 *
 * Matching strategy (in priority order):
 *   1. Match by id — exact instance match.
 *   2. Match by name, preserving relative occurrence order for duplicates.
 *
 * Steps present in the saved config but absent from the current catalog
 * are silently dropped — they no longer exist in the system.
 *
 * Steps present in the catalog but absent from the saved config are kept
 * with their defaults — this is the "no migration needed" guarantee.
 */
export function mergeWithDefaultConfig(
	saved: Partial<UnifiedFlowConfig>,
	graphType: string,
): UnifiedFlowConfig {
	const normalizedGraphType = normalizeFlowGraphType(
		typeof saved.graphType === "string" ? saved.graphType : graphType,
	);
	const base = buildDefaultFlowConfig(normalizedGraphType);
	const stepIndexesById = new Map(
		base.steps.map((step, index) => [step.id, index] as const),
	);
	const stepIndexesByName = new Map<string, number[]>();
	const matchedIndexes = new Set<number>();

	base.steps.forEach((step, index) => {
		const indexes = stepIndexesByName.get(step.name) ?? [];
		indexes.push(index);
		stepIndexesByName.set(step.name, indexes);
	});

	for (const savedStep of saved.steps ?? []) {
		const byIdIndex =
			typeof savedStep.id === "string"
				? stepIndexesById.get(savedStep.id)
				: undefined;
		if (byIdIndex !== undefined && !matchedIndexes.has(byIdIndex)) {
			Object.assign(base.steps[byIdIndex], savedStep);
			matchedIndexes.add(byIdIndex);
			continue;
		}

		const byNameIndexes = stepIndexesByName.get(savedStep.name) ?? [];
		const nextIndex = byNameIndexes.find((index) => !matchedIndexes.has(index));
		if (nextIndex !== undefined) {
			Object.assign(base.steps[nextIndex], savedStep);
			matchedIndexes.add(nextIndex);
		}
	}

	return { graphType: normalizedGraphType, steps: base.steps };
}
