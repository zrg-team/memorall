import type { ChatCompletionChunk } from "flow-core/interfaces/engine/messages";

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
	| { type: string };
