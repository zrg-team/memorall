import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { type FlowRuntimeVars, getFlowRuntimeVars } from "./runtime-context.js";

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
	/** Messages waiting to be taken; a long tool call returns early for them. */
	readonly size: number;
}

/** Where a run keeps its inbox among its runtime vars. */
export const FLOW_RUN_INBOX_RUNTIME_KEY = "__flowRunInbox";

/**
 * What a message sent mid-run is wrapped in wherever the model reads it. Left
 * bare, the model takes the newest user message as the whole request and drops
 * the task it was on; marked as a "by the way", it does both.
 */
export const FLOW_RUN_INBOX_TAG = "by-the-way" as const;

const OPEN_TAG = `<${FLOW_RUN_INBOX_TAG}>\n`;
const CLOSE_TAG = `\n</${FLOW_RUN_INBOX_TAG}>`;

/**
 * A message sent mid-run as the model reads it. The reply stores it this way
 * too, so the next turn's history repeats the bytes this run sent.
 */
export const formatFlowRunInboxMessage = (content: string): string =>
	`${OPEN_TAG}${content}${CLOSE_TAG}`;

/** The user's own words back from a stored message; anything else as is. */
export const unwrapFlowRunInboxMessage = (content: string): string =>
	content.length >= OPEN_TAG.length + CLOSE_TAG.length &&
	content.startsWith(OPEN_TAG) &&
	content.endsWith(CLOSE_TAG)
		? content.slice(OPEN_TAG.length, -CLOSE_TAG.length)
		: content;

/** How the agent reads a tagged message, attached for the rest of the run. */
export const FLOW_RUN_INBOX_REMINDER = [
	`The user wrote to you while you were working: the <${FLOW_RUN_INBOX_TAG}> message after your tool results.`,
	"It is an addition to the request you are working on, not a replacement for it.",
	"Handle it too, keep going until the original request is done, and answer both in your reply.",
	"Stop, cancel or switch tasks only when the message explicitly asks you to.",
].join(" ");

class DefaultFlowRunInbox implements FlowRunInbox {
	private pending: FlowRunInboxMessage[] = [];
	private isClosed = false;

	get closed(): boolean {
		return this.isClosed;
	}

	get size(): number {
		return this.pending.length;
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

/** The run's inbox among its runtime vars (a tool's `context.runtime`). */
export const getFlowRunInboxFromVars = (
	vars?: FlowRuntimeVars,
): FlowRunInbox | undefined => {
	const inbox = vars?.get(FLOW_RUN_INBOX_RUNTIME_KEY);
	return isFlowRunInbox(inbox) ? inbox : undefined;
};

/** The run's inbox, when whoever started the run gave it one. */
export const getFlowRunInbox = (
	runConfig?: LangGraphRunnableConfig,
): FlowRunInbox | undefined =>
	getFlowRunInboxFromVars(getFlowRuntimeVars(runConfig));
