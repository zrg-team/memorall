import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { getFlowRuntimeVars } from "./runtime-context.js";

/** A message the user sent while the run was still going. */
export interface FlowRunInboxMessage {
	/** The sender's id for it, reported back when the agent reads it. */
	id: string;
	content: string;
}

/**
 * Messages the user sends to a run in progress. The agent loop takes them
 * before its next request, so the model reads them after the tool results it
 * is working on instead of after the whole reply. Once the run is over the
 * inbox is closed and refuses more: the sender sends those as a new message.
 */
export interface FlowRunInbox {
	/** False once the run is over: the message was not taken. */
	push(message: FlowRunInboxMessage): boolean;
	/** Everything sent since the last take, oldest first. */
	take(): FlowRunInboxMessage[];
	/** Ends the inbox and hands back what nobody took. */
	close(): FlowRunInboxMessage[];
	readonly closed: boolean;
}

/** Where a run keeps its inbox among its runtime vars. */
export const FLOW_RUN_INBOX_RUNTIME_KEY = "__flowRunInbox";

class DefaultFlowRunInbox implements FlowRunInbox {
	private pending: FlowRunInboxMessage[] = [];
	private isClosed = false;

	get closed(): boolean {
		return this.isClosed;
	}

	push(message: FlowRunInboxMessage): boolean {
		if (this.isClosed || !message.content.trim()) return false;
		this.pending.push({ id: message.id, content: message.content });
		return true;
	}

	take(): FlowRunInboxMessage[] {
		const taken = this.pending;
		this.pending = [];
		return taken;
	}

	close(): FlowRunInboxMessage[] {
		this.isClosed = true;
		return this.take();
	}
}

export const createFlowRunInbox = (): FlowRunInbox => new DefaultFlowRunInbox();

const isFlowRunInbox = (value: unknown): value is FlowRunInbox =>
	!!value &&
	typeof value === "object" &&
	typeof (value as Partial<FlowRunInbox>).push === "function" &&
	typeof (value as Partial<FlowRunInbox>).take === "function";

/** The run's inbox, when whoever started the run gave it one. */
export const getFlowRunInbox = (
	runConfig?: LangGraphRunnableConfig,
): FlowRunInbox | undefined => {
	const inbox = getFlowRuntimeVars(runConfig)?.get(FLOW_RUN_INBOX_RUNTIME_KEY);
	return isFlowRunInbox(inbox) ? inbox : undefined;
};
