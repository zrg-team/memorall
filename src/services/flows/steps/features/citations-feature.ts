import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	FEATURE_DEFAULT_OUTPUTS,
	type FeatureCatalogMetadata,
} from "../../feature-catalog-registry";

const STEP_NAME = "citations" as const;

featureCatalogRegistry.register({
	id: "step-citations",
	name: STEP_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: FEATURE_DEFAULT_OUTPUTS,
	metadata: {
		description:
			"Append source citations to responses when knowledge context is used.",
		descriptionKey: "agentSettings.citationsDesc",
		displayName: "Citations",
		nameKey: "agentSettings.citations",
		tools: [],
		systemPrompt: "",
		customizable: false,
		icon: { name: "Quote", type: "lucide" },
		accentColor: "#a855f7",
		recommended: true,
		section: "other",
		sectionOrder: 1,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: never;
	}
}
