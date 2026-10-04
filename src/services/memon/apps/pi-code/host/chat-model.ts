/**
 * pi's LLM provider for this app: whatever model the chat has selected.
 *
 * Registered with pi-ai's provider registry under CHAT_MODEL_API, so pi's
 * agent loop and its compaction both stream through
 * `llmService.chatCompletionsFor(serviceName, { stream: true, tools })`.
 * Message conversion, tool-call accumulation, usage and stop reasons follow
 * pi-ai's openai-completions provider.
 */
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionMessageParam,
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionTool,
	ChatCompletionUsage,
	ReasoningEffort,
} from "@/types/openai";
import {
	type AssistantMessage,
	AssistantMessageEventStream,
	calculateCost,
	clampThinkingLevel,
	type Context,
	type Model,
	type ModelThinkingLevel,
	parseStreamingJson,
	registerApiProvider,
	type SimpleStreamOptions,
	type StopReason,
	sanitizeSurrogates,
	type TextContent,
	type ThinkingContent,
	type ThinkingLevelMap,
	type ToolCall,
	transformMessages,
} from "../ai";

export const CHAT_MODEL_API = "memorall-chat";

/** Used when the service cannot say how large the model's context is. */
const FALLBACK_CONTEXT_WINDOW = 128_000;
const FALLBACK_MAX_TOKENS = 16_384;

type LlmSource = () => Promise<ILLMService>;

/** Models seen so far: the service each one is served by. */
const servicesByModel = new Map<string, string>();
const modelKey = (provider: string, id: string) => `${provider}:${id}`;

let llmSource: LlmSource | undefined;

const PI_THINKING_LEVELS: Exclude<ModelThinkingLevel, "off">[] = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

/** pi thinking level → the effort the model accepts (null: not supported). */
function thinkingLevelMapFor(
	efforts: ReasoningEffort[],
	mandatory: boolean,
): ThinkingLevelMap {
	const map: ThinkingLevelMap = {
		off: mandatory ? null : efforts.includes("none") ? "none" : undefined,
	};
	for (const level of PI_THINKING_LEVELS) {
		map[level] = efforts.includes(level) ? level : null;
	}
	if (!efforts.includes("xhigh") && efforts.includes("max")) {
		map.xhigh = "max";
	}
	return map;
}

/** The model info a listing gives, read structurally (fields vary by provider). */
interface ListedModel {
	id: string;
	name?: string;
	supportsVision?: boolean;
	reasoning?: { efforts?: ReasoningEffort[]; mandatory?: boolean };
	pricing?: {
		inputPerMillion?: number;
		outputPerMillion?: number;
		cachedInputPerMillion?: number;
	};
}

/** The chat's current model as a pi Model, or undefined when none is selected. */
export async function resolveChatModel(
	getLlm: LlmSource,
): Promise<Model<typeof CHAT_MODEL_API> | undefined> {
	const llm = await getLlm();
	const current = await llm.getCurrentModel();
	if (!current) return undefined;
	const { modelId, provider, serviceName } = current;
	servicesByModel.set(modelKey(provider, modelId), serviceName);

	const listed = await llm
		.modelsFor(serviceName)
		.then(
			(list) =>
				list.data.find((model) => model.id === modelId) as
					| ListedModel
					| undefined,
		)
		.catch(() => undefined);
	const contextWindow = await llm
		.getMaxModelTokensFor(serviceName, modelId)
		.catch(() => 0);
	const maxTokens = await llm
		.getMaxResponseTokensFor(serviceName, modelId)
		.catch(() => 0);
	const efforts = listed?.reasoning?.efforts ?? [];
	const reasoning = efforts.length > 0;

	return {
		id: modelId,
		name: listed?.name ?? modelId,
		api: CHAT_MODEL_API,
		provider,
		baseUrl: "",
		reasoning,
		thinkingLevelMap: reasoning
			? thinkingLevelMapFor(efforts, Boolean(listed?.reasoning?.mandatory))
			: undefined,
		input: listed?.supportsVision ? ["text", "image"] : ["text"],
		cost: {
			input: listed?.pricing?.inputPerMillion ?? 0,
			output: listed?.pricing?.outputPerMillion ?? 0,
			cacheRead:
				listed?.pricing?.cachedInputPerMillion ??
				listed?.pricing?.inputPerMillion ??
				0,
			cacheWrite: 0,
		},
		contextWindow: contextWindow > 0 ? contextWindow : FALLBACK_CONTEXT_WINDOW,
		maxTokens: maxTokens > 0 ? maxTokens : FALLBACK_MAX_TOKENS,
	};
}

/** The pi thinking level the chat composer's reasoning effort corresponds to. */
export function thinkingLevelForEffort(
	effort: ReasoningEffort | undefined,
): ModelThinkingLevel | undefined {
	if (!effort) return undefined;
	if (effort === "none") return "off";
	if (effort === "max") return "xhigh";
	return effort;
}

const isTextBlock = (block: { type: string }): block is TextContent =>
	block.type === "text";
const isToolCallBlock = (block: { type: string }): block is ToolCall =>
	block.type === "toolCall";

/** pi Context → chat completion messages (pi-ai convertMessages, plain OpenAI dialect). */
export function toChatMessages(
	model: Model<string>,
	context: Context,
): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];
	const messages = transformMessages(context.messages, model, (id) => id);

	if (context.systemPrompt) {
		params.push({
			role: "system",
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				params.push({ role: "user", content: sanitizeSurrogates(msg.content) });
				continue;
			}
			const content = msg.content.map(
				(item): ChatCompletionContentPart =>
					item.type === "text"
						? { type: "text", text: sanitizeSurrogates(item.text) }
						: {
								type: "image_url",
								image_url: { url: `data:${item.mimeType};base64,${item.data}` },
							},
			);
			if (content.length > 0) params.push({ role: "user", content });
		} else if (msg.role === "assistant") {
			// Always a plain string: content-part arrays make some models echo the structure.
			const text = msg.content
				.filter(isTextBlock)
				.filter((block) => block.text.trim().length > 0)
				.map((block) => sanitizeSurrogates(block.text))
				.join("");
			const toolCalls = msg.content.filter(isToolCallBlock);
			// Skip assistant messages with neither content nor tool calls (aborted responses).
			if (!text && toolCalls.length === 0) continue;
			params.push({
				role: "assistant",
				content: text || null,
				...(toolCalls.length > 0
					? {
							tool_calls: toolCalls.map((tc) => ({
								id: tc.id,
								type: "function" as const,
								function: {
									name: tc.name,
									arguments: JSON.stringify(tc.arguments),
								},
							})),
						}
					: {}),
			});
		} else if (msg.role === "toolResult") {
			const imageParts: ChatCompletionContentPart[] = [];
			let j = i;
			for (; j < messages.length && messages[j].role === "toolResult"; j++) {
				const toolMsg = messages[j];
				if (toolMsg.role !== "toolResult") break;
				const textResult = toolMsg.content
					.filter(isTextBlock)
					.map((block) => block.text)
					.join("\n");
				params.push({
					role: "tool",
					content: sanitizeSurrogates(
						textResult.length > 0 ? textResult : "(see attached image)",
					),
					tool_call_id: toolMsg.toolCallId,
				});
				if (model.input.includes("image")) {
					for (const block of toolMsg.content) {
						if (block.type === "image") {
							imageParts.push({
								type: "image_url",
								image_url: {
									url: `data:${block.mimeType};base64,${block.data}`,
								},
							});
						}
					}
				}
			}
			i = j - 1;
			if (imageParts.length > 0) {
				params.push({
					role: "user",
					content: [
						{ type: "text", text: "Attached image(s) from tool result:" },
						...imageParts,
					],
				});
			}
		}
	}
	return params;
}

function toChatTools(context: Context): ChatCompletionTool[] | undefined {
	if (!context.tools || context.tools.length === 0) return undefined;
	return context.tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters as Record<string, unknown>,
		},
	}));
}

function toUsage(
	raw: ChatCompletionUsage,
	model: Model<string>,
): AssistantMessage["usage"] {
	const promptTokens = raw.prompt_tokens || 0;
	const cacheWrite = raw.cache_write_tokens || 0;
	const reportedCached = raw.cached_tokens || 0;
	// Some gateways report cached tokens as earlier hits plus this request's writes.
	const cacheRead =
		cacheWrite > 0 ? Math.max(0, reportedCached - cacheWrite) : reportedCached;
	const input = Math.max(0, promptTokens - cacheRead - cacheWrite);
	const output = raw.completion_tokens || 0;
	const usage: AssistantMessage["usage"] = {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	// The provider's own figure (OpenRouter) wins over the listed price.
	if (typeof raw.cost === "number" && Number.isFinite(raw.cost)) {
		usage.cost.total = raw.cost;
	}
	return usage;
}

function mapStopReason(reason: string | null): {
	stopReason: StopReason;
	errorMessage?: string;
} {
	switch (reason) {
		case null:
		case "stop":
		case "end":
			return { stopReason: "stop" };
		case "length":
			return { stopReason: "length" };
		case "function_call":
		case "tool_calls":
			return { stopReason: "toolUse" };
		default:
			return {
				stopReason: "error",
				errorMessage: `Provider finish_reason: ${reason}`,
			};
	}
}

const isAsyncIterable = (
	value: unknown,
): value is AsyncIterable<ChatCompletionChunk> =>
	typeof value === "object" && value !== null && Symbol.asyncIterator in value;

/** A non-streaming response as the one chunk a stream would have carried. */
async function* asChunks(
	response: ChatCompletionResponse,
): AsyncIterable<ChatCompletionChunk> {
	const choice = response.choices[0];
	yield {
		id: response.id,
		object: "chat.completion.chunk",
		created: response.created,
		model: response.model,
		usage: response.usage,
		choices: choice
			? [
					{
						index: 0,
						finish_reason: choice.finish_reason,
						delta: {
							content: choice.message.content,
							tool_calls: choice.message.tool_calls?.map((call, index) => ({
								index,
								id: call.id,
								type: "function",
								function: call.function,
							})),
						},
					},
				]
			: [],
	};
}

/** The effort to request for pi's thinking level, or none for the model's default. */
function reasoningEffortFor(
	model: Model<string>,
	options?: SimpleStreamOptions,
): ReasoningEffort | undefined {
	if (!model.reasoning) return undefined;
	const level = clampThinkingLevel(model, options?.reasoning ?? "off");
	const mapped = model.thinkingLevelMap?.[level];
	return typeof mapped === "string" ? (mapped as ReasoningEffort) : undefined;
}

function streamChatModel(
	model: Model<string>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	void (async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			if (!llmSource) throw new Error("The chat model is not connected.");
			const llm = await llmSource();
			const serviceName = servicesByModel.get(
				modelKey(model.provider, model.id),
			);
			if (!serviceName)
				throw new Error(
					`The chat model ${model.provider}/${model.id} is not available.`,
				);

			const request: ChatCompletionRequest = {
				model: model.id,
				messages: toChatMessages(model, context),
				tools: toChatTools(context),
				stream: true,
				stream_options: { include_usage: true },
				signal: options?.signal,
				...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
				...(options?.temperature !== undefined
					? { temperature: options.temperature }
					: {}),
				...(options?.sessionId
					? { prompt_cache_key: `pi:${options.sessionId}` }
					: {}),
			};
			const reasoningEffort = reasoningEffortFor(model, options);
			if (reasoningEffort) request.reasoning_effort = reasoningEffort;

			const result = llm.chatCompletionsFor(serviceName, request);
			const chunks = isAsyncIterable(result) ? result : asChunks(await result);
			stream.push({ type: "start", partial: output });

			interface StreamingToolCallBlock extends ToolCall {
				partialArgs?: string;
				streamIndex?: number;
			}
			type StreamingBlock =
				| TextContent
				| ThinkingContent
				| StreamingToolCallBlock;
			let textBlock: TextContent | null = null;
			let thinkingBlock: ThinkingContent | null = null;
			const toolCallsByIndex = new Map<number, StreamingToolCallBlock>();
			const toolCallsById = new Map<string, StreamingToolCallBlock>();
			const blocks = output.content as StreamingBlock[];
			const indexOf = (block: StreamingBlock) => blocks.indexOf(block);

			const finishBlock = (block: StreamingBlock) => {
				const contentIndex = indexOf(block);
				if (contentIndex === -1) return;
				if (block.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex,
						content: block.text,
						partial: output,
					});
				} else if (block.type === "thinking") {
					stream.push({
						type: "thinking_end",
						contentIndex,
						content: block.thinking,
						partial: output,
					});
				} else {
					block.arguments = parseStreamingJson(block.partialArgs);
					delete block.partialArgs;
					delete block.streamIndex;
					stream.push({
						type: "toolcall_end",
						contentIndex,
						toolCall: block,
						partial: output,
					});
				}
			};

			for await (const chunk of chunks) {
				if (!chunk || typeof chunk !== "object") continue;
				output.responseId ||= chunk.id;
				if (chunk.model && chunk.model !== model.id)
					output.responseModel ||= chunk.model;
				if (chunk.usage) output.usage = toUsage(chunk.usage, model);

				const choice = chunk.choices?.[0];
				if (!choice) continue;
				if (choice.finish_reason) {
					const mapped = mapStopReason(choice.finish_reason);
					output.stopReason = mapped.stopReason;
					if (mapped.errorMessage) output.errorMessage = mapped.errorMessage;
				}
				const delta = choice.delta;
				if (!delta) continue;

				if (delta.content) {
					if (!textBlock) {
						textBlock = { type: "text", text: "" };
						blocks.push(textBlock);
						stream.push({
							type: "text_start",
							contentIndex: indexOf(textBlock),
							partial: output,
						});
					}
					textBlock.text += delta.content;
					stream.push({
						type: "text_delta",
						contentIndex: indexOf(textBlock),
						delta: delta.content,
						partial: output,
					});
				}

				if (delta.reasoning) {
					if (!thinkingBlock) {
						thinkingBlock = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "reasoning",
						};
						blocks.push(thinkingBlock);
						stream.push({
							type: "thinking_start",
							contentIndex: indexOf(thinkingBlock),
							partial: output,
						});
					}
					thinkingBlock.thinking += delta.reasoning;
					stream.push({
						type: "thinking_delta",
						contentIndex: indexOf(thinkingBlock),
						delta: delta.reasoning,
						partial: output,
					});
				}

				for (const call of delta.tool_calls ?? []) {
					const streamIndex =
						typeof call.index === "number" ? call.index : undefined;
					let block =
						streamIndex !== undefined
							? toolCallsByIndex.get(streamIndex)
							: undefined;
					if (!block && call.id) block = toolCallsById.get(call.id);
					if (!block) {
						block = {
							type: "toolCall",
							id: call.id || "",
							name: call.function?.name || "",
							arguments: {},
							partialArgs: "",
							streamIndex,
						};
						if (streamIndex !== undefined)
							toolCallsByIndex.set(streamIndex, block);
						blocks.push(block);
						stream.push({
							type: "toolcall_start",
							contentIndex: indexOf(block),
							partial: output,
						});
					}
					if (call.id) {
						if (!block.id) block.id = call.id;
						toolCallsById.set(call.id, block);
					}
					if (!block.name && call.function?.name)
						block.name = call.function.name;
					const argsDelta = call.function?.arguments ?? "";
					if (argsDelta) {
						block.partialArgs = (block.partialArgs ?? "") + argsDelta;
						block.arguments = parseStreamingJson(block.partialArgs);
					}
					stream.push({
						type: "toolcall_delta",
						contentIndex: indexOf(block),
						delta: argsDelta,
						partial: output,
					});
				}
			}

			for (const block of blocks) finishBlock(block);
			// Tool calls without an id cannot be answered; give them one.
			for (const block of blocks) {
				if (block.type === "toolCall" && !block.id)
					block.id = `call_${crypto.randomUUID().slice(0, 8)}`;
			}
			if (
				blocks.some((block) => block.type === "toolCall") &&
				output.stopReason === "stop"
			) {
				output.stopReason = "toolUse";
			}
			if (options?.signal?.aborted || output.stopReason === "aborted") {
				throw new Error("Request was aborted");
			}
			if (output.stopReason === "error") {
				throw new Error(
					output.errorMessage || "Provider returned an error stop reason",
				);
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) {
				delete (block as { partialArgs?: string }).partialArgs;
				delete (block as { streamIndex?: number }).streamIndex;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage =
				error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

/** Connect pi's provider registry to the app's LLM service (idempotent). */
export function registerChatModelProvider(getLlm: LlmSource): void {
	llmSource = getLlm;
	registerApiProvider(
		{
			api: CHAT_MODEL_API,
			stream: streamChatModel,
			streamSimple: streamChatModel,
		},
		"memon-chat-model",
	);
}
