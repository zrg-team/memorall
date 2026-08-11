export const SEND_MESSAGE_TO_AGENT_TOOL_NAME = "send_message_to_agent" as const;

export interface SendMessageToAgentToolConfig {
	multiAgentManager: {
		sendMessage(
			agentId: string,
			message: string,
		): Promise<{
			response: string;
		}>;
	};
}
