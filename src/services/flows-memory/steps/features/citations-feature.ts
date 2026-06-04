import { stepRegistry } from "flow-core/registries/step-registry";
const STEP_NAME = "citations" as const;

stepRegistry.register(STEP_NAME, {
	feature: {
		id: "step-citations",
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
