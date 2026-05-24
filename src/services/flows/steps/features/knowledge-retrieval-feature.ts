import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	FEATURE_DEFAULT_OUTPUTS,
	type FeatureCatalogMetadata,
} from "@/services/flows/feature-catalog-registry";
import { DEFAULT_CONTEXT_SYSTEM_PROMPT } from "@/services/flows/steps/common/context-to-system";

const STEP_NAME = "knowledge-retrieval" as const;

featureCatalogRegistry.register({
	id: "step-knowledge-retrieval",
	name: STEP_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: FEATURE_DEFAULT_OUTPUTS,
	metadata: {
		description:
			"Retrieve relevant knowledge from the agent memory graph before responding.",
		descriptionKey: "agentSettings.contextRetrievalDesc",
		displayName: "Knowledge Retrieval",
		nameKey: "agentSettings.contextRetrieval",
		tools: [],
		systemPrompt: "",
		customizable: true,
		icon: { name: "Database", type: "lucide" },
		accentColor: "#22c55e",
		recommended: true,
		section: "core",
		sectionOrder: 0,
		detailView: [
			{ component: "RetrievalModeSelect", configName: "retrievalMode" },
			{
				component: "PromptInput",
				configName: "contextPrompt",
				labelKey: "agentSettings.contextPrompt",
				hintKey: "agentSettings.contextPromptHint",
				defaultValue: DEFAULT_CONTEXT_SYSTEM_PROMPT,
			},
		],
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: never;
	}
}
