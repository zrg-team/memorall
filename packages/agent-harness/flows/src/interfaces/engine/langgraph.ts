import type { ChatCompletionChunk } from "./messages.js";

export type LangGraphStreamChunk =
	| [string, unknown]
	| [string[], string, unknown]
	| unknown;

export type FlowAction = {
	id: string;
	name: string;
	description?: string;
	metadata: Record<string, unknown>;
};

export type LangGraphCustomChunkPayload =
	| { type: "llm"; chunk: ChatCompletionChunk }
	| { type: "actions"; actions: FlowAction[] }
	| { type: "execute-start"; node: string; metadata?: Record<string, unknown> }
	/** The conversation was compacted before the next request. */
	| { type: "compact"; metadata: CompactionReport }
	| { type: string };

/** What a compaction did, for the chat to show where it happened. */
export interface CompactionReport {
	/** "threshold": the window was filling up; "token-budget": the provider refused. */
	reason: "threshold" | "token-budget";
	/** Estimated prompt tokens before and after. */
	beforeTokens: number;
	afterTokens: number;
	/** The model's window, or the budget the provider named. */
	windowTokens: number;
	/** Tool results cut to their head and tail. */
	shortened: number;
	/** Messages taken out (old tool calls with their results, old turns). */
	removed: number;
}
