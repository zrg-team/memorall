import { stepRegistry } from "../../registries/step-registry.js";
const STEP_NAME = "agent-node" as const;

stepRegistry.register(STEP_NAME, {
	feature: {
		id: "step-agent-node",
		type: "feature",
		graphTypes: ["foundation", "agent"],
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
