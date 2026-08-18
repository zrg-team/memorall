export type {
	LangGraphStreamChunk,
	LangGraphCustomChunkPayload,
	FlowAction,
} from "../interfaces/engine/langgraph.js";

import type {
	LangGraphStreamChunk,
	LangGraphCustomChunkPayload,
} from "../interfaces/engine/langgraph.js";

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
