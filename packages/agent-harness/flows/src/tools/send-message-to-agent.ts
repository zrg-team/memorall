import z from "zod";
import {
	TOOL_PROGRESS_EVENT,
	type Tool,
	type ToolFactory,
	type ToolProgressEvent,
} from "../interfaces/engine/tool.js";
import { toolRegistry } from "../registries/tool-registry.js";
import {
	CHILD_AGENT_RUN_META_KEY,
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	type SendMessageToAgentToolConfig,
} from "../interfaces/tools/multi-agent.js";

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
		"Send a focused message to a selected child agent. The child agent keeps its own conversation for the current run, including its earlier tool calls and results, so a follow-up only needs what is new.",
	schema,
	execute: async (input, context) => {
		const multiAgentManager = config?.multiAgentManager;
		if (!multiAgentManager) {
			throw new Error("Multi-agent manager is not available.");
		}

		const { writer, toolCallId } = context ?? {};
		const result = await multiAgentManager.sendMessage(
			input.agentId,
			input.message,
			{
				writer,
				onProgress:
					writer && toolCallId
						? (run) =>
								writer({
									type: TOOL_PROGRESS_EVENT,
									node: "tool_executor",
									metadata: {
										tool: SEND_MESSAGE_TO_AGENT_TOOL_NAME,
										tool_call_id: toolCallId,
										meta: { [CHILD_AGENT_RUN_META_KEY]: run },
									},
								} satisfies ToolProgressEvent)
						: undefined,
			},
		);
		// The parent reads the reply; the work behind it is for the chat to show.
		return {
			content: result.response,
			meta: { [CHILD_AGENT_RUN_META_KEY]: result.run },
		};
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
