import { generateId, reply } from "../../utils/common.js";
import { postprocessGeneratedText } from "./text-utils.js";

export function createStreamChunk(modelId, token) {
	return {
		id: `chatcmpl-${generateId()}`,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [
			{
				index: 0,
				delta: token ? { content: token } : {},
				finish_reason: null,
			},
		],
	};
}

export function createStreamEndChunk(modelId) {
	return {
		id: `chatcmpl-${generateId()}`,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [
			{
				index: 0,
				delta: {},
				finish_reason: "stop",
			},
		],
	};
}

export function createCompletionResponse(modelId, decoded, usage) {
	return {
		id: `chatcmpl-${generateId()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: decoded,
				},
				finish_reason: "stop",
			},
		],
		usage,
	};
}

export function emitPostprocessedDelta(
	modelId,
	src,
	origin,
	messageId,
	rawText,
	state,
	bundle,
) {
	state.rawText += rawText;
	const cleaned = postprocessGeneratedText(state.rawText, bundle);
	if (!cleaned.startsWith(state.cleanedText)) {
		if (cleaned) {
			reply(
				src,
				origin,
				messageId,
				"stream_chunk",
				createStreamChunk(modelId, cleaned),
			);
		}
		state.cleanedText = cleaned;
		return;
	}

	const delta = cleaned.slice(state.cleanedText.length);
	if (delta) {
		reply(
			src,
			origin,
			messageId,
			"stream_chunk",
			createStreamChunk(modelId, delta),
		);
	}
	state.cleanedText = cleaned;
}

export function toRunnerErrorPayload(error, overrides = {}) {
	const message =
		error instanceof Error ? error.message : String(error || "Unknown error");
	const type =
		typeof overrides.type === "string"
			? overrides.type
			: error instanceof Error && error.name
				? error.name
				: "Error";

	return {
		error: {
			message,
			type,
			code: overrides.code ?? null,
			modelId: overrides.modelId ?? null,
			serviceName: "transformer",
		},
	};
}
