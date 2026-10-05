import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import {
	extractChunkOutputText,
	extractResponseOutputText,
	resolveTokenUsage,
	type TokenUsage,
} from "@/services/llm/utils/token-usage";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type { ImageGenerationStreamEvent } from "@/types/openai-media";
import {
	type ModelUsageRecorder,
	type ModelUsageScope,
	recordModelUsage,
} from "./model-usage-ledger";

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
	typeof value === "object" && value !== null && Symbol.asyncIterator in value;

/** A media endpoint's `{ input_tokens, output_tokens, cost }` as token usage. */
const mediaUsage = (
	usage:
		| { input_tokens?: number; output_tokens?: number; cost?: number }
		| undefined,
): TokenUsage | undefined => {
	if (!usage) return undefined;
	const input = usage.input_tokens ?? 0;
	const output = usage.output_tokens ?? 0;
	if (input + output === 0 && usage.cost === undefined) return undefined;
	return {
		prompt_tokens: input,
		completion_tokens: output,
		total_tokens: input + output,
		...(usage.cost !== undefined ? { cost: usage.cost } : {}),
	};
};

declare const metered: unique symbol;

/**
 * An LLM service whose model requests are booked in the model usage ledger.
 * Only meterLlmService makes one, so code that takes it cannot be handed the
 * app's unmetered service by mistake.
 */
export type MeteredLlmService = ILLMService & { readonly [metered]: true };

type MeteredMethods = Pick<
	ILLMService,
	| "chatCompletions"
	| "chatCompletionsFor"
	| "systemOneFor"
	| "imagesGenerationsFor"
>;

/**
 * The LLM service with every model request booked to `scope` in the model
 * usage ledger: chat completions (streamed or not), decisions and image
 * generations. A request whose provider reports no usage, or that is cut off
 * before the usage arrives, is booked as an estimate, as chat replies are. A
 * request that fails before producing anything is not booked. Everything
 * else (model listing, serving, endpoints without token usage) passes
 * through unchanged.
 */
export const meterLlmService = (
	llm: ILLMService,
	scope: () => ModelUsageScope,
	record: ModelUsageRecorder = recordModelUsage,
): MeteredLlmService => {
	const providerOf = (serviceName: string | null): string => {
		try {
			return (
				(serviceName ? llm.getInfoFor(serviceName) : llm.getInfo()).type ||
				serviceName ||
				""
			);
		} catch {
			return serviceName ?? "";
		}
	};

	const book = (serviceName: string | null, model: string, usage: TokenUsage) =>
		void record({
			...scope(),
			provider: providerOf(serviceName),
			model,
			usage,
		});

	async function* meterChunks(
		serviceName: string | null,
		request: ChatCompletionRequest,
		chunks: AsyncIterable<ChatCompletionChunk>,
	): AsyncGenerator<ChatCompletionChunk, void, undefined> {
		let usage: ChatCompletionChunk["usage"];
		let model = request.model ?? "";
		let output = "";
		let failed = false;
		try {
			for await (const chunk of chunks) {
				if (chunk.usage) usage = chunk.usage;
				if (chunk.model) model = chunk.model;
				output += extractChunkOutputText(chunk);
				yield chunk;
			}
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			// Billed unless it failed before the provider wrote anything.
			if (usage || !failed || output || request.signal?.aborted) {
				book(
					serviceName,
					model,
					resolveTokenUsage(usage, request.messages, output),
				);
			}
		}
	}

	const meterChat = (
		serviceName: string | null,
		request: ChatCompletionRequest,
		result:
			| Promise<ChatCompletionResponse>
			| AsyncIterableIterator<ChatCompletionChunk>,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> =>
		isAsyncIterable<ChatCompletionChunk>(result)
			? meterChunks(serviceName, request, result)
			: result.then((response) => {
					book(
						serviceName,
						response.model || request.model || "",
						resolveTokenUsage(
							response.usage,
							request.messages,
							extractResponseOutputText(response),
						),
					);
					return response;
				});

	async function* meterImages(
		serviceName: string,
		model: string,
		events: AsyncIterable<ImageGenerationStreamEvent>,
	): AsyncGenerator<ImageGenerationStreamEvent, void, undefined> {
		for await (const event of events) {
			if (event.type === "image_generation.completed") {
				const usage = mediaUsage(event.result.usage);
				if (usage) book(serviceName, model, usage);
			}
			yield event;
		}
	}

	const methods: MeteredMethods = {
		chatCompletions: (request) =>
			meterChat(null, request, llm.chatCompletions(request)),
		chatCompletionsFor: (name, request) =>
			meterChat(name, request, llm.chatCompletionsFor(name, request)),
		systemOneFor: (name, request) =>
			llm.systemOneFor(name, request).then((response) => {
				const usage = mediaUsage(response.usage);
				if (usage) book(name, response.model || request.model, usage);
				return response;
			}),
		imagesGenerationsFor: (name, request) =>
			meterImages(name, request.model, llm.imagesGenerationsFor(name, request)),
	};

	return new Proxy(llm, {
		get(target, property) {
			if (Object.hasOwn(methods, property)) {
				return methods[property as keyof MeteredMethods];
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as MeteredLlmService;
};
