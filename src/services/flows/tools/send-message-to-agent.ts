import z from "zod";
import type { Tool, ToolFactory } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";
import {
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	type SendMessageToAgentToolConfig,
} from "../steps/features/multi-agent-feature/tool-contract";

const schema = z.object({
	agentId: z.string().min(1).describe("Target child agent flow ID."),
	message: z
		.string()
		.min(1)
		.describe("Focused message to send to the selected child agent."),
});

type Input = z.infer<typeof schema>;

export const createSendMessageToAgentTool: ToolFactory<
	Input,
	void,
	SendMessageToAgentToolConfig
> = (_services, config): Tool<Input> => ({
	name: SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	description:
		"Send a focused message to a selected child agent. The child agent keeps its own conversation history for the current run.",
	schema,
	execute: async (input) => {
		const multiAgentManager = config?.multiAgentManager;
		if (!multiAgentManager) {
			throw new Error("Multi-agent manager is not available.");
		}

		const result = await multiAgentManager.sendMessage(
			input.agentId,
			input.message,
		);
		return result.response;
	},
});

toolRegistry.register(
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	createSendMessageToAgentTool,
);

declare global {
	interface ToolTypeRegistry {
		[SEND_MESSAGE_TO_AGENT_TOOL_NAME]: {
			input: Input;
			services: void;
			config: SendMessageToAgentToolConfig;
		};
	}
}
