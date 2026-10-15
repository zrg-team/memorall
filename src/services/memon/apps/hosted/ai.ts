import type { MeteredLlmService } from "@/services/model-usage/metered-llm";
import {
	HOSTED_APPS_USAGE_SOURCE,
	type ModelUsageScope,
} from "@/services/model-usage/model-usage-ledger";
import {
	accumulateChunkToolCalls,
	createToolCallAccumulator,
	getAccumulatedToolCalls,
} from "@/services/chat/tool-call-accumulator";
import type {
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionFinishReason,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionRequest,
	ChatCompletionTool,
	ChatCompletionUsage,
} from "@/types/openai";
import { HostedBridgeError } from "./bridge";
import { HOSTED_APPS, type HostedAppId } from "./catalog";
import type { HostedChatPart } from "./protocol";

/**
 * The AI a hosted app asks for through Puter's `puter.ai.chat`, answered by
 * the chat model the user chose in Memorall. The apps bring their own
 * conversations, tools and features (a slide assistant, formula help, Smart
 * Lookup); only the model is Memorall's. A model the app names is Puter's
 * choice, not the user's, and is not used. Every request is booked in the
 * model usage ledger, so the Usage page counts it.
 */

/** What the apps' AI needs of Memorall's language models. */
export interface HostedChatModel {
	/** A chat model is chosen. */
	ready(): Promise<boolean>;
	/** The chosen model's answer, streamed. */
	stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;
}

/** An answer whole, in the shape Puter's SDK resolves `chat` with. */
export interface HostedChatReply {
	message: {
		role: "assistant";
		content: string;
		tool_calls?: ChatCompletionMessageToolCall[];
	};
	finish_reason: ChatCompletionFinishReason;
	usage: ChatCompletionUsage | null;
}

export interface HostedChatOptions {
	signal?: AbortSignal;
	/** Each part as it arrives; a streamed request is answered this way. */
	onPart?: (part: HostedChatPart) => void;
}

export interface HostedAppAi {
	chat(
		params: Record<string, unknown>,
		options?: HostedChatOptions,
	): Promise<HostedChatReply>;
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);

const invalid = (message: string) =>
	new HostedBridgeError(message, "invalid_request");

const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

/** Text, or text and pictures; anything else in a message is not sent. */
const toContent = (
	value: unknown,
): string | ChatCompletionContentPart[] | null => {
	if (value == null) return null;
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return String(value);
	const parts: ChatCompletionContentPart[] = [];
	for (const part of value) {
		if (typeof part === "string") parts.push({ type: "text", text: part });
		else if (isObject(part) && typeof part.text === "string")
			parts.push({ type: "text", text: part.text });
		else if (
			isObject(part) &&
			isObject(part.image_url) &&
			typeof part.image_url.url === "string"
		)
			parts.push({ type: "image_url", image_url: { url: part.image_url.url } });
	}
	return parts;
};

const textOf = (content: string | ChatCompletionContentPart[] | null) =>
	typeof content === "string"
		? content
		: (content ?? [])
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("");

/** The app's conversation, in the shape Memorall's models take (OpenAI's). */
export const toChatMessages = (
	value: unknown,
): ChatCompletionMessageParam[] => {
	if (!Array.isArray(value) || value.length === 0)
		throw invalid("The request has no messages.");
	return value.map((entry): ChatCompletionMessageParam => {
		if (!isObject(entry) || !ROLES.has(String(entry.role)))
			throw invalid("A message has no known role.");
		const content = toContent(entry.content);
		switch (entry.role) {
			case "system":
				return { role: "system", content: textOf(content) };
			case "tool":
				return {
					role: "tool",
					content: textOf(content),
					tool_call_id: String(entry.tool_call_id ?? ""),
				};
			case "assistant":
				return {
					role: "assistant",
					content: content === null ? null : textOf(content),
					...(Array.isArray(entry.tool_calls) && entry.tool_calls.length
						? {
								tool_calls: entry.tool_calls as ChatCompletionMessageToolCall[],
							}
						: {}),
				};
			default:
				return { role: "user", content: content ?? "" };
		}
	});
};

const toTools = (value: unknown): ChatCompletionTool[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const tools = value.filter(
		(tool): tool is ChatCompletionTool =>
			isObject(tool) &&
			isObject(tool.function) &&
			typeof tool.function.name === "string",
	);
	return tools.length ? tools : undefined;
};

/** The request for Memorall's model: the app's options it can honour. */
export const toChatRequest = (
	params: Record<string, unknown>,
): ChatCompletionRequest => {
	const tools = toTools(params.tools);
	return {
		messages: toChatMessages(params.messages),
		stream: true,
		stream_options: { include_usage: true },
		...(tools ? { tools } : {}),
		...(typeof params.max_tokens === "number"
			? { max_tokens: params.max_tokens }
			: {}),
		...(typeof params.temperature === "number"
			? { temperature: params.temperature }
			: {}),
	};
};

/** A tool call's arguments; what cannot be read is marked so, as the apps do. */
const toolInput = (text: string): Record<string, unknown> => {
	if (!text.trim()) return {};
	try {
		const value = JSON.parse(text);
		return isObject(value) ? value : { value };
	} catch {
		return { __unreadable: text };
	}
};

export const createHostedAppAi = (model: HostedChatModel): HostedAppAi => ({
	async chat(params, { signal, onPart } = {}) {
		const request = toChatRequest(params);
		if (!(await model.ready()))
			throw new HostedBridgeError(
				"Choose a chat model in Memorall to use AI here.",
				"no_model",
			);
		let text = "";
		let finish: ChatCompletionFinishReason = null;
		let usage: ChatCompletionUsage | null = null;
		const calls = createToolCallAccumulator();
		try {
			for await (const chunk of model.stream({ ...request, signal })) {
				if (chunk.usage) usage = chunk.usage;
				const choice = chunk.choices?.[0];
				if (!choice) continue;
				const delta = choice.delta ?? {};
				if (delta.reasoning)
					onPart?.({ type: "reasoning", reasoning: delta.reasoning });
				if (delta.content) {
					text += delta.content;
					onPart?.({ type: "text", text: delta.content });
				}
				accumulateChunkToolCalls(calls, delta.tool_calls);
				if (choice.finish_reason) finish = choice.finish_reason;
			}
		} catch (error) {
			if (signal?.aborted)
				throw new HostedBridgeError("The answer was stopped.", "cancelled");
			throw new HostedBridgeError(
				error instanceof Error ? error.message : String(error),
				"ai_failed",
			);
		}
		const toolCalls = getAccumulatedToolCalls(calls);
		for (const call of toolCalls)
			onPart?.({
				type: "tool_use",
				id: call.id,
				name: call.function.name,
				input: toolInput(call.function.arguments),
			});
		if (usage) onPart?.({ type: "usage", usage });
		return {
			message: {
				role: "assistant",
				content: text,
				...(toolCalls.length ? { tool_calls: toolCalls } : {}),
			},
			finish_reason: finish,
			usage,
		};
	},
});

/**
 * Who an app's AI is charged to on the Usage page: the app, each file its own
 * session, and the agent whose computer it is on (none on the Files page).
 */
export const hostedAppUsageScope = ({
	app,
	path,
	agentId = null,
}: {
	app: HostedAppId;
	path: string | null;
	agentId?: string | null;
}): ModelUsageScope => ({
	source: HOSTED_APPS_USAGE_SOURCE,
	tool: app,
	agentId,
	conversationId: null,
	sessionId: `${app}:${path ?? ""}`,
	title: path
		? `${HOSTED_APPS[app].name} · ${path.split("/").pop()}`
		: HOSTED_APPS[app].name,
});

/**
 * Memorall's language models, as the apps' AI uses them: the chat model,
 * metered so its use counts on the Usage page.
 */
export const hostedChatModel = (llm: MeteredLlmService): HostedChatModel => ({
	ready: async () => !!(await llm.getCurrentModel().catch(() => null)),
	// A streamed request is answered with its chunks.
	stream: (request) =>
		llm.chatCompletions({
			...request,
			stream: true,
		}) as AsyncIterable<ChatCompletionChunk>,
});
