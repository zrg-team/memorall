/**
 * Runtime vars every chat run carries, so tools can scope per-conversation
 * state without guessing. `getRuntimeGraphId` is not a substitute: it prefers
 * the memory graph id, which active-memory shares across conversations.
 */
export const CONVERSATION_RUNTIME_KEY = "conversation.id";
export const RUN_RUNTIME_KEY = "run.id";
/** The agent (flow) the run belongs to, when the chat has one selected. */
export const AGENT_RUNTIME_KEY = "agent.flow.id";

export const getRunAgentId = (
	runtime: { get(key: string): unknown } | undefined,
): string | undefined => {
	const agentId = runtime?.get(AGENT_RUNTIME_KEY);
	return typeof agentId === "string" && agentId ? agentId : undefined;
};

/** Reads the conversation id, or the run id for unsaved chats. */
export const getConversationScopeKey = (
	runtime:
		| {
				get(key: string): unknown;
		  }
		| undefined,
): string | undefined => {
	const conversationId = runtime?.get(CONVERSATION_RUNTIME_KEY);
	if (typeof conversationId === "string" && conversationId) {
		return conversationId;
	}
	const runId = runtime?.get(RUN_RUNTIME_KEY);
	return typeof runId === "string" && runId ? runId : undefined;
};
