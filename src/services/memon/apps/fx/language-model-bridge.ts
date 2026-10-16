/**
 * The AI SDK language-model protocol, answered with Memorall's own models.
 *
 * fx sends every model request to its model gateway as an AI SDK
 * language-model call (specification version 4): the prompt as AI SDK
 * messages, the tools as JSON-schema functions, and the reply expected as a
 * server-sent stream of AI SDK stream parts. Memorall's models speak OpenAI
 * Chat Completions, so this translates the call into a chat request and the
 * streamed chunks back into stream parts. Both directions are pure; the
 * transport that serves them lives with the app.
 */

import type {
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionFinishReason,
	ChatCompletionMessageParam,
	ChatCompletionRequest,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
	ChatCompletionUsage,
	ReasoningEffort,
} from "@/types/openai";

// ─── The call ────────────────────────────────────────────────────────────────

interface TextPart {
	type: "text";
	text: string;
}

interface FilePart {
	type: "file";
	/** Base64 data or a URL, once the call has travelled as JSON. */
	data: string;
	mediaType: string;
	filename?: string;
}

interface ReasoningPart {
	type: "reasoning";
	text: string;
}

interface ToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
}

type ToolResultOutput =
	| { type: "text" | "error-text"; value: string }
	| { type: "json" | "error-json"; value: unknown }
	| { type: "execution-denied"; reason?: string }
	| {
			type: "content";
			value: Array<
				| { type: "text"; text: string }
				| { type: string; data?: string; mediaType?: string }
			>;
	  };

interface ToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: ToolResultOutput;
}

export type LanguageModelMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: Array<TextPart | FilePart> }
	| {
			role: "assistant";
			content: Array<TextPart | FilePart | ReasoningPart | ToolCallPart>;
	  }
	| { role: "tool"; content: ToolResultPart[] };

export interface LanguageModelFunctionTool {
	type: "function";
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

export interface LanguageModelCall {
	prompt: LanguageModelMessage[];
	tools?: Array<LanguageModelFunctionTool | { type: string; name?: string }>;
	toolChoice?:
		| { type: "auto" | "none" | "required" }
		| { type: "tool"; toolName: string };
	maxOutputTokens?: number;
	temperature?: number;
	topP?: number;
	topK?: number;
	stopSequences?: string[];
	providerOptions?: Record<string, Record<string, unknown>>;
}

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** fx's reasoning effort, wherever a provider's options carry it. */
const reasoningEffortOf = (
	providerOptions: LanguageModelCall["providerOptions"],
): ReasoningEffort | undefined => {
	for (const options of Object.values(providerOptions ?? {})) {
		const effort = options?.reasoningEffort;
		if (REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
			return effort as ReasoningEffort;
		}
	}
	return undefined;
};

const dataUrlOf = (part: FilePart): string =>
	/^(https?:|data:)/i.test(part.data)
		? part.data
		: `data:${part.mediaType};base64,${part.data}`;

/** A tool result as the text a Chat Completions tool message carries. */
const toolResultText = (output: ToolResultOutput): string => {
	switch (output.type) {
		case "text":
		case "error-text":
			return output.value;
		case "json":
		case "error-json":
			return JSON.stringify(output.value);
		case "execution-denied":
			return output.reason
				? `The user denied this action: ${output.reason}`
				: "The user denied this action.";
		case "content":
			return output.value
				.map((item) =>
					item.type === "text" && "text" in item
						? item.text
						: `[${item.type}${"mediaType" in item && item.mediaType ? ` ${item.mediaType}` : ""} omitted]`,
				)
				.join("\n");
	}
};

const toChatMessages = (
	prompt: LanguageModelMessage[],
): ChatCompletionMessageParam[] => {
	// fx sends its instructions as several system messages; many providers take
	// one, so they travel together.
	const system = prompt
		.filter((message) => message.role === "system")
		.map((message) => message.content)
		.filter(Boolean)
		.join("\n\n");
	const messages: ChatCompletionMessageParam[] = system
		? [{ role: "system", content: system }]
		: [];

	for (const message of prompt) {
		switch (message.role) {
			case "system":
				break;
			case "user": {
				const parts: ChatCompletionContentPart[] = message.content.flatMap(
					(part): ChatCompletionContentPart[] => {
						if (part.type === "text")
							return [{ type: "text", text: part.text }];
						if (part.mediaType.startsWith("image/")) {
							return [
								{
									type: "image_url",
									image_url: { url: dataUrlOf(part), mimeType: part.mediaType },
								},
							];
						}
						return [
							{
								type: "text",
								text: `[${part.filename ?? part.mediaType} attached, not readable by this model]`,
							},
						];
					},
				);
				const textOnly = parts.every((part) => part.type === "text");
				messages.push({
					role: "user",
					content: textOnly
						? parts
								.map((part) => (part.type === "text" ? part.text : ""))
								.join("\n")
						: parts,
				});
				break;
			}
			case "assistant": {
				const text = message.content
					.flatMap((part) => (part.type === "text" ? [part.text] : []))
					.join("");
				const toolCalls = message.content.flatMap((part) =>
					part.type === "tool-call"
						? [
								{
									id: part.toolCallId,
									type: "function" as const,
									function: {
										name: part.toolName,
										arguments:
											typeof part.input === "string"
												? part.input
												: JSON.stringify(part.input ?? {}),
									},
								},
							]
						: [],
				);
				messages.push({
					role: "assistant",
					content: text || null,
					...(toolCalls.length ? { tool_calls: toolCalls } : {}),
				});
				break;
			}
			case "tool":
				for (const part of message.content) {
					if (part.type !== "tool-result") continue;
					messages.push({
						role: "tool",
						tool_call_id: part.toolCallId,
						content: toolResultText(part.output),
					});
				}
				break;
		}
	}
	return messages;
};

const toChatTools = (tools: LanguageModelCall["tools"]): ChatCompletionTool[] =>
	(tools ?? []).flatMap((tool) =>
		tool.type === "function" && "inputSchema" in tool
			? [
					{
						type: "function" as const,
						function: {
							name: tool.name,
							...(tool.description ? { description: tool.description } : {}),
							parameters: tool.inputSchema,
						},
					},
				]
			: [],
	);

const toChatToolChoice = (
	choice: LanguageModelCall["toolChoice"],
): ChatCompletionToolChoiceOption | undefined => {
	if (!choice) return undefined;
	if (choice.type === "tool") {
		return { type: "function", function: { name: choice.toolName } };
	}
	return choice.type;
};

/** The chat request that asks a Memorall model what fx asked its gateway. */
export const toChatCompletionRequest = (
	call: LanguageModelCall,
): ChatCompletionRequest => {
	const tools = toChatTools(call.tools);
	const toolChoice = tools.length
		? toChatToolChoice(call.toolChoice)
		: undefined;
	const effort = reasoningEffortOf(call.providerOptions);
	return {
		messages: toChatMessages(call.prompt),
		stream: true,
		stream_options: { include_usage: true },
		...(tools.length ? { tools } : {}),
		...(toolChoice ? { tool_choice: toolChoice } : {}),
		...(call.maxOutputTokens ? { max_tokens: call.maxOutputTokens } : {}),
		...(call.temperature !== undefined
			? { temperature: call.temperature }
			: {}),
		...(call.topP !== undefined ? { top_p: call.topP } : {}),
		...(call.topK !== undefined ? { top_k: call.topK } : {}),
		...(call.stopSequences?.length ? { stop: call.stopSequences } : {}),
		...(effort ? { reasoning_effort: effort } : {}),
	};
};

// ─── The reply ───────────────────────────────────────────────────────────────

type UnifiedFinishReason =
	| "stop"
	| "length"
	| "content-filter"
	| "tool-calls"
	| "error"
	| "other";

export interface LanguageModelUsage {
	inputTokens: {
		total: number;
		noCache: number;
		cacheRead: number;
		cacheWrite: number;
	};
	outputTokens: { total: number; text: number; reasoning: number };
}

export type LanguageModelStreamPart =
	| { type: "stream-start"; warnings: [] }
	| { type: "response-metadata"; id?: string; modelId?: string }
	| {
			type: "text-start" | "text-end" | "reasoning-start" | "reasoning-end";
			id: string;
	  }
	| { type: "text-delta" | "reasoning-delta"; id: string; delta: string }
	| { type: "tool-input-start"; id: string; toolName: string }
	| { type: "tool-input-delta"; id: string; delta: string }
	| { type: "tool-input-end"; id: string }
	| { type: "tool-call"; toolCallId: string; toolName: string; input: string }
	| {
			type: "finish";
			finishReason: { unified: UnifiedFinishReason; raw: string | undefined };
			usage: LanguageModelUsage;
	  }
	| { type: "error"; error: string };

const unifiedFinishReason = (
	reason: ChatCompletionFinishReason | undefined,
	calledTools: boolean,
): UnifiedFinishReason => {
	// Some providers end a turn that called tools with "stop"; fx runs the
	// calls only when the turn says it made them.
	if (calledTools) return "tool-calls";
	switch (reason) {
		case "length":
			return "length";
		case "content_filter":
			return "content-filter";
		case "tool_calls":
			return "tool-calls";
		default:
			return "stop";
	}
};

export const toLanguageModelUsage = (
	usage: ChatCompletionUsage | null | undefined,
): LanguageModelUsage => {
	const input = usage?.prompt_tokens ?? 0;
	const cacheRead = usage?.cached_tokens ?? 0;
	const output = usage?.completion_tokens ?? 0;
	const reasoning = usage?.reasoning_tokens ?? 0;
	return {
		inputTokens: {
			total: input,
			noCache: Math.max(0, input - cacheRead),
			cacheRead,
			cacheWrite: usage?.cache_write_tokens ?? 0,
		},
		outputTokens: {
			total: output,
			text: Math.max(0, output - reasoning),
			reasoning,
		},
	};
};

interface PendingToolCall {
	id: string;
	name: string;
	/** Argument text that arrived before the call's name did. */
	buffered: string;
	arguments: string;
	started: boolean;
}

/**
 * Chat chunks as AI SDK stream parts. Text and reasoning stream as they
 * arrive; a tool call streams its input once its name is known and is
 * announced whole when the reply ends, the way the AI SDK reports one.
 */
export async function* toLanguageModelStream(
	chunks: AsyncIterable<ChatCompletionChunk>,
	modelId: string,
): AsyncGenerator<LanguageModelStreamPart> {
	yield { type: "stream-start", warnings: [] };

	let metadataSent = false;
	let textOpen = false;
	let reasoningOpen = false;
	let finishReason: ChatCompletionFinishReason | undefined;
	let usage: ChatCompletionUsage | null | undefined;
	const toolCalls = new Map<number, PendingToolCall>();

	for await (const chunk of chunks) {
		if (!metadataSent) {
			metadataSent = true;
			yield {
				type: "response-metadata",
				id: chunk.id,
				modelId: chunk.model || modelId,
			};
		}
		if (chunk.usage) usage = chunk.usage;
		for (const choice of chunk.choices ?? []) {
			const delta = choice.delta ?? {};
			if (delta.reasoning) {
				if (!reasoningOpen) {
					reasoningOpen = true;
					yield { type: "reasoning-start", id: "reasoning-0" };
				}
				yield {
					type: "reasoning-delta",
					id: "reasoning-0",
					delta: delta.reasoning,
				};
			}
			if (delta.content) {
				if (reasoningOpen) {
					reasoningOpen = false;
					yield { type: "reasoning-end", id: "reasoning-0" };
				}
				if (!textOpen) {
					textOpen = true;
					yield { type: "text-start", id: "text-0" };
				}
				yield { type: "text-delta", id: "text-0", delta: delta.content };
			}
			for (const call of delta.tool_calls ?? []) {
				const pending = toolCalls.get(call.index) ?? {
					id: "",
					name: "",
					buffered: "",
					arguments: "",
					started: false,
				};
				toolCalls.set(call.index, pending);
				if (call.id) pending.id = call.id;
				if (call.function?.name) pending.name += call.function.name;
				const argumentText = call.function?.arguments ?? "";
				if (!pending.started && pending.name) {
					pending.id ||= `call_${call.index}`;
					pending.started = true;
					yield {
						type: "tool-input-start",
						id: pending.id,
						toolName: pending.name,
					};
					if (pending.buffered) {
						yield {
							type: "tool-input-delta",
							id: pending.id,
							delta: pending.buffered,
						};
					}
				}
				if (argumentText) {
					pending.arguments += argumentText;
					if (pending.started) {
						yield {
							type: "tool-input-delta",
							id: pending.id,
							delta: argumentText,
						};
					} else {
						pending.buffered += argumentText;
					}
				}
			}
			if (choice.finish_reason) finishReason = choice.finish_reason;
		}
	}

	if (reasoningOpen) yield { type: "reasoning-end", id: "reasoning-0" };
	if (textOpen) yield { type: "text-end", id: "text-0" };

	const calls = [...toolCalls.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, call]) => call)
		.filter((call) => call.name);
	for (const call of calls) {
		if (!call.started) {
			call.id ||= `call_${calls.indexOf(call)}`;
			yield { type: "tool-input-start", id: call.id, toolName: call.name };
			if (call.arguments) {
				yield { type: "tool-input-delta", id: call.id, delta: call.arguments };
			}
		}
		yield { type: "tool-input-end", id: call.id };
		yield {
			type: "tool-call",
			toolCallId: call.id,
			toolName: call.name,
			input: call.arguments.trim() || "{}",
		};
	}

	yield {
		type: "finish",
		finishReason: {
			unified: unifiedFinishReason(finishReason, calls.length > 0),
			raw: finishReason ?? undefined,
		},
		usage: toLanguageModelUsage(usage),
	};
}

/** Stream parts as the server-sent events fx reads from its gateway. */
export const toEventStream = (
	parts: AsyncIterable<LanguageModelStreamPart>,
): ReadableStream<Uint8Array> => {
	const encoder = new TextEncoder();
	const iterator = parts[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) {
					controller.close();
					return;
				}
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`),
				);
			} catch (error) {
				// A failure after the reply started reaches fx as an error part, so
				// the terminal shows why instead of a cut-off answer.
				const message = error instanceof Error ? error.message : String(error);
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({ type: "error", error: message })}\n\n`,
					),
				);
				controller.close();
			}
		},
		async cancel() {
			await iterator.return?.(undefined);
		},
	});
};
