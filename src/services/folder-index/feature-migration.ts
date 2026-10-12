import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	FOLDER_INDEX_STEP_NAME,
	FILE_OKF_INDEX_STEP_NAME,
	FILE_EMBEDDING_INDEX_STEP_NAME,
} from "./constants";

const INDEX_FEATURES = [
	{ name: FILE_OKF_INDEX_STEP_NAME, suffix: "okf" },
	{ name: FILE_EMBEDDING_INDEX_STEP_NAME, suffix: "embeddings" },
];

/** Preserve the combined feature's tools while giving each index its own toggle. */
export const splitFolderIndexFeatures = <T extends Partial<UnifiedFlowConfig>>(
	config: T,
): T => {
	const steps = config.steps;
	if (!steps?.some((step) => step.name === FOLDER_INDEX_STEP_NAME))
		return config;
	const enabled = steps.some(
		(step) => step.name === FOLDER_INDEX_STEP_NAME && step.enabled,
	);
	const names = new Set(steps.map((step) => step.name));
	const ids = new Set(steps.map((step) => step.id));
	return {
		...config,
		steps: steps.flatMap((step) => {
			if (step.name !== FOLDER_INDEX_STEP_NAME) return [step];
			return INDEX_FEATURES.flatMap((feature) => {
				// An explicit choice in the new format wins, including a disabled toggle.
				if (names.has(feature.name)) return [];
				names.add(feature.name);
				let id = `${step.id}:${feature.suffix}`;
				for (let n = 1; ids.has(id); n++)
					id = `${step.id}:${feature.suffix}:${n}`;
				ids.add(id);
				return [{ ...step, id, name: feature.name, enabled }];
			});
		}),
	};
};

export const splitFolderIndexFeatureFlags = (
	flags: Record<string, boolean>,
): Record<string, boolean> => {
	if (!(FOLDER_INDEX_STEP_NAME in flags)) return flags;
	const { [FOLDER_INDEX_STEP_NAME]: enabled, ...rest } = flags;
	return {
		...rest,
		[FILE_OKF_INDEX_STEP_NAME]: flags[FILE_OKF_INDEX_STEP_NAME] ?? enabled,
		[FILE_EMBEDDING_INDEX_STEP_NAME]:
			flags[FILE_EMBEDDING_INDEX_STEP_NAME] ?? enabled,
	};
};
