export type LangGraphStreamChunk =
	| [string, unknown]
	| [string[], string, unknown]
	| unknown;

import type { ChatCompletionChunk } from "../interfaces/messages";

export type FlowAction = {
	id: string;
	name: string;
	description?: string;
	metadata: Record<string, unknown>;
};

export type LangGraphCustomChunkPayload =
	| {
			type: "llm";
			chunk: ChatCompletionChunk;
	  }
	| {
			type: "actions";
			actions: FlowAction[];
	  }
	| {
			type: "execute-start";
			node: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: string;
	  };

export function normalizeLangGraphStreamChunk(value: LangGraphStreamChunk): {
	mode: string;
	payload: unknown;
} {
	if (Array.isArray(value)) {
		if (value.length === 3) {
			return { mode: String(value[1]), payload: value[2] };
		}
		if (value.length === 2) {
			return { mode: String(value[0]), payload: value[1] };
		}
	}
	return { mode: "values", payload: value };
}

export function isCustomChunkPayload(
	payload: unknown,
): payload is LangGraphCustomChunkPayload {
	return (
		!!payload &&
		typeof payload === "object" &&
		"type" in payload &&
		typeof (payload as { type?: string }).type === "string"
	);
}
