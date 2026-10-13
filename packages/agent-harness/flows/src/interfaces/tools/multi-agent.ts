import type { ChatCompletionUsage } from "../engine/messages.js";

export const SEND_MESSAGE_TO_AGENT_TOOL_NAME = "send_message_to_agent" as const;

/** One thing the child agent did while answering, in the order it happened. */
export type ChildAgentStep =
	| { type: "text"; content: string }
	| {
			type: "tool";
			id: string;
			name: string;
			/** The call's arguments, clipped for display. */
			input?: string;
			/** The result, clipped for display; absent while the call runs. */
			output?: string;
			status: "running" | "completed" | "failed";
			startedAt?: string;
			durationMs?: number;
	  };

/** An earlier message in the same child conversation, as a reminder of it. */
export interface ChildAgentExchange {
	turn: number;
	/** What the parent asked, clipped. */
	message: string;
	/** What the child answered, clipped. */
	reply: string;
	/** Tool calls the child made for it. */
	tools: number;
}

/**
 * One message to a child agent and everything it did to answer it. Reported
 * on the tool result's `meta` (and as progress while it runs) for the chat to
 * show; the parent model only ever reads the child's reply.
 */
export interface ChildAgentRun {
	agent: { id: string; name: string };
	/** Which message this is in the child's conversation, from 1. */
	turn: number;
	/**
	 * The latest messages before this one, oldest first. The child reads all of
	 * them, tool calls included, before it reads this one.
	 */
	history: ChildAgentExchange[];
	status: "running" | "completed";
	steps: ChildAgentStep[];
	/** Model requests the child made, summed; absent until one reports. */
	usage?: ChatCompletionUsage;
	requests: number;
}

/** Where a child run sits on a tool result's `meta`. */
export const CHILD_AGENT_RUN_META_KEY = "childRun" as const;

export interface ChildAgentMessageOptions {
	/** The parent tool node's writer: usage is reported into the parent run. */
	writer?: (chunk: unknown) => void;
	onProgress?: (run: ChildAgentRun) => void;
}

export interface ChildAgentMessageResult {
	response: string;
	run: ChildAgentRun;
}

export interface SendMessageToAgentToolConfig {
	multiAgentManager: {
		sendMessage(
			agentId: string,
			message: string,
			options?: ChildAgentMessageOptions,
		): Promise<ChildAgentMessageResult>;
	};
}
