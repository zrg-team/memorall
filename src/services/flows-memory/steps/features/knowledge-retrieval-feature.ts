import { stepRegistry } from "flow-core/registries/step-registry";
import { DEFAULT_CONTEXT_SYSTEM_PROMPT } from "flow-core/steps/common/context-to-system";

const STEP_NAME = "knowledge-retrieval" as const;

stepRegistry.register(STEP_NAME, {
	feature: {
		id: "step-knowledge-retrieval",
		type: "feature",
		graphTypes: ["foundation"],
		inputs: [
			{
				name: "messages",
				type: "Message[]",
				required: true,
				description: "Current chat messages",
			},
			{
				name: "tools",
				type: "Tool[]",
				required: true,
				description: "Current available tools",
			},
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages updated by the feature.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended by the feature.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: never;
	}
}
