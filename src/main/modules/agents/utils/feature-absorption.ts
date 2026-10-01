import type { AgentFeatureDefinition } from "@/main/stores/agent-config";

type StepConfigEntry = { name: string; config?: Record<string, unknown> };

/**
 * Features an enabled feature has taken over, keyed by the absorbed feature's
 * name. MemonOS Bot absorbs web, files and sandbox unless its settings keep the
 * direct tools; runs switch the absorbed steps off, so their tools must not be
 * counted as enabled either.
 */
export const getAbsorbedFeatures = (
	featureDefinitions: AgentFeatureDefinition[],
	draftFeatures: Record<string, boolean>,
	steps: StepConfigEntry[] = [],
): Map<string, AgentFeatureDefinition> => {
	const absorbed = new Map<string, AgentFeatureDefinition>();
	for (const feature of featureDefinitions) {
		if (!feature.absorbsFeatures?.length || !draftFeatures[feature.name]) {
			continue;
		}
		const stepConfig = steps.find((step) => step.name === feature.name)?.config;
		if (stepConfig?.keepDirectTools === true) continue;
		for (const name of feature.absorbsFeatures) absorbed.set(name, feature);
	}
	return absorbed;
};
