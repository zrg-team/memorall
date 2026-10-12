import type { AgentFeatureDefinition } from "@/main/stores/agent-config";
import {
	MEMON_NATIVE_SANDBOX_TOOLS,
	MEMON_STEP_NAME,
} from "@/services/memon/constants";

type StepConfigEntry = { name: string; config?: Record<string, unknown> };

/**
 * Features an enabled feature has taken over, keyed by the absorbed feature's
 * name. MemonOS Bot absorbs web, files and sandbox unless its settings keep the
 * direct tools. Native tools no longer count; any additional tools still do.
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

/** A taken-over feature can still contribute tools the computer does not have. */
export const getFeatureTools = (
	feature: AgentFeatureDefinition,
	absorbed: Map<string, AgentFeatureDefinition>,
): string[] => {
	const absorber = absorbed.get(feature.name);
	if (!absorber) return feature.tools;
	if (
		absorber.name === MEMON_STEP_NAME &&
		feature.name === "nodejs-sandbox-feature"
	) {
		const native = new Set<string>(MEMON_NATIVE_SANDBOX_TOOLS);
		return feature.tools.filter((tool) => !native.has(tool));
	}
	return [];
};
