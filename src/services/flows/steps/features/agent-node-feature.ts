import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	FEATURE_DEFAULT_OUTPUTS,
	type FeatureCatalogMetadata,
} from "@/services/flows/feature-catalog-registry";

const STEP_NAME = "agent-node" as const;

featureCatalogRegistry.register({
	id: "step-agent-node",
	name: STEP_NAME,
	type: "feature",
	graphTypes: ["foundation", "agent"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: FEATURE_DEFAULT_OUTPUTS,
	metadata: {
		description: "Select which tools this agent can use during response generation.",
		descriptionKey: "agentSettings.agentToolsDesc",
		displayName: "Agent Tools",
		nameKey: "agentSettings.agentTools",
		tools: [],
		systemPrompt: "",
		customizable: false,
		icon: { name: "Wrench", type: "lucide" },
		accentColor: "#f59e0b",
		recommended: true,
		section: "core",
		sectionOrder: 5,
		detailView: [
			{ component: "ToolPicker", configName: "tools", scope: "all" },
		],
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: never;
	}
}
