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
			/**
			 * The result, clipped for display; absent while the call runs. JSON
			 * stays JSON, with long strings and lists cut, so it still reads as
			 * the tool's result.
			 */
			output?: string;
			/** stopped: the run ended while the call was still going. */
			status: "running" | "completed" | "failed" | "stopped";
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
	/**
	 * completed: it ran to the end. stopped: cut off before it could reply, by
	 * its step limit or a stop. failed: an error ended it.
	 */
	status: "running" | "completed" | "stopped" | "failed";
	/** Why a stopped or failed run ended. */
	endReason?: "step_limit" | "aborted" | "error";
	/** The error that ended a failed run, clipped. */
	error?: string;
	endedAt?: string;
	steps: ChildAgentStep[];
	/** Earliest steps left out to keep the run small enough to report. */
	omittedSteps?: number;
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
