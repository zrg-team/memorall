/**
 * The model gateway fx talks to, served by Memorall.
 *
 * fx sends its model requests to Vercel's AI Gateway. In MemonOS the
 * terminal's `fetch` is this one: model calls go to the user's own Memorall
 * models through the metered LLM service, the model catalog lists the chat
 * model's provider, and nothing else leaves the machine. fx never holds a
 * provider key; it is given a placeholder so it does not ask to sign in.
 */

import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ChatCompletionChunk,
	ChatCompletionResponse,
} from "@/types/openai";
import {
	type LanguageModelCall,
	type LanguageModelStreamPart,
	toChatCompletionRequest,
	toEventStream,
	toLanguageModelStream,
} from "./language-model-bridge";

export const FX_GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
/** fx's model ids for Memorall's models: `memorall/<model id>`. */
export const FX_MODEL_PREFIX = "memorall/";
/** What fx sends as its gateway key; the gateway here ignores it. */
export const FX_GATEWAY_PLACEHOLDER_KEY = "memorall";

export type FxGatewayModels = Pick<
	ILLMService,
	| "getCurrentModel"
	| "modelsFor"
	| "getMaxModelTokensFor"
	| "getMaxResponseTokensFor"
	| "chatCompletionsFor"
>;

export interface FxGatewayOptions {
	/** The metered LLM service fx's requests are booked through. */
	models: () => Promise<FxGatewayModels>;
	/** fx's session a request belongs to, for the usage it is booked to. */
	onSession?: (sessionId: string) => void;
}

export const fxModelId = (modelId: string): string =>
	`${FX_MODEL_PREFIX}${modelId}`;

/** The model fx starts on: whichever model the chat has selected now. */
const FX_CHAT_ALIAS = "chat";
export const FX_CHAT_MODEL = fxModelId(FX_CHAT_ALIAS);

const json = (status: number, body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const failure = (status: number, message: string): Response =>
	json(status, { error: { message, type: "memorall_error" } });

const NO_MODEL =
	"No chat model is selected in Memorall. Choose one in the chat composer, then try again.";

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
	typeof (value as AsyncIterable<T>)?.[Symbol.asyncIterator] === "function";

/** A whole reply as the one chunk a stream of it would end with. */
async function* asChunks(
	response: ChatCompletionResponse,
): AsyncGenerator<ChatCompletionChunk> {
	const choice = response.choices[0];
	yield {
		id: response.id,
		object: "chat.completion.chunk",
		created: response.created,
		model: response.model,
		choices: [
			{
				index: 0,
				delta: {
					content: choice?.message.content ?? null,
					tool_calls: choice?.message.tool_calls?.map((call, index) => ({
						index,
						id: call.id,
						type: "function" as const,
						function: call.function,
					})),
				},
				finish_reason: choice?.finish_reason ?? "stop",
			},
		],
		usage: response.usage,
	};
}

/**
 * The model fx asked for (/model) on the chat model's service, or the chat
 * model: for the chat alias, and for a model that service does not list.
 */
const resolveModel = async (
	llm: FxGatewayModels,
	requested: string | null,
): Promise<{ serviceName: string; modelId: string } | null> => {
	const current = await llm.getCurrentModel();
	if (!current) return null;
	const wanted = requested?.startsWith(FX_MODEL_PREFIX)
		? requested.slice(FX_MODEL_PREFIX.length)
		: requested;
	if (wanted && wanted !== FX_CHAT_ALIAS && wanted !== current.modelId) {
		const listed = await llm
			.modelsFor(current.serviceName)
			.then((list) => list.data.some((model) => model.id === wanted))
			.catch(() => false);
		if (listed) return { serviceName: current.serviceName, modelId: wanted };
	}
	return { serviceName: current.serviceName, modelId: current.modelId };
};

/** A reply fx did not ask to stream, as the AI SDK's generate result. */
const generateResult = async (
	parts: AsyncIterable<LanguageModelStreamPart>,
): Promise<Record<string, unknown>> => {
	let text = "";
	let reasoning = "";
	const content: Record<string, unknown>[] = [];
	let finish: Extract<LanguageModelStreamPart, { type: "finish" }> | undefined;
	let response: { id?: string; modelId?: string } = {};
	for await (const part of parts) {
		if (part.type === "text-delta") text += part.delta;
		else if (part.type === "reasoning-delta") reasoning += part.delta;
		else if (part.type === "tool-call") content.push({ ...part });
		else if (part.type === "response-metadata") response = part;
		else if (part.type === "finish") finish = part;
	}
	return {
		content: [
			...(reasoning ? [{ type: "reasoning", text: reasoning }] : []),
			...(text ? [{ type: "text", text }] : []),
			...content,
		],
		finishReason: finish?.finishReason ?? { unified: "stop", raw: undefined },
		usage: finish?.usage,
		warnings: [],
		response: { id: response.id, modelId: response.modelId },
	};
};

const answerModelCall = async (
	options: FxGatewayOptions,
	headers: Headers,
	body: string,
	signal: AbortSignal | undefined,
): Promise<Response> => {
	let call: LanguageModelCall;
	try {
		call = JSON.parse(body) as LanguageModelCall;
	} catch {
		return failure(400, "The model request was not valid JSON.");
	}
	const sessionId = headers.get("x-session-id");
	if (sessionId) options.onSession?.(sessionId);

	const llm = await options.models();
	const model = await resolveModel(llm, headers.get("ai-language-model-id"));
	if (!model) return failure(409, NO_MODEL);

	const request = {
		...toChatCompletionRequest(call),
		model: model.modelId,
		signal,
		...(sessionId ? { prompt_cache_key: `fx:${sessionId}` } : {}),
	};
	let chunks: AsyncIterable<ChatCompletionChunk>;
	try {
		const result = llm.chatCompletionsFor(model.serviceName, request);
		chunks = isAsyncIterable<ChatCompletionChunk>(result)
			? result
			: asChunks(await result);
	} catch (error) {
		return failure(502, error instanceof Error ? error.message : String(error));
	}
	const parts = toLanguageModelStream(chunks, fxModelId(model.modelId));

	if (headers.get("ai-language-model-streaming") === "false") {
		try {
			return json(200, await generateResult(parts));
		} catch (error) {
			return failure(
				502,
				error instanceof Error ? error.message : String(error),
			);
		}
	}
	return new Response(toEventStream(parts), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
};

/**
 * The models fx's /model menu offers: the chat model (following whatever the
 * chat selects), then the chat model's provider's models.
 */
const answerCatalog = async (options: FxGatewayOptions): Promise<Response> => {
	const llm = await options.models();
	const current = await llm.getCurrentModel();
	if (!current) return json(200, { object: "list", data: [] });
	const listed = await llm
		.modelsFor(current.serviceName)
		.then((list) => list.data)
		.catch(() => []);
	const ids = new Set([current.modelId, ...listed.map((model) => model.id)]);
	const limits = async (modelId: string) => ({
		context: await llm
			.getMaxModelTokensFor(current.serviceName, modelId)
			.catch(() => 0),
		output: await llm
			.getMaxResponseTokensFor(current.serviceName, modelId)
			.catch(() => 0),
	});
	// Limits are looked up for the chat model only: a provider can list
	// hundreds of models, and asking each one costs a round trip.
	const currentLimits = await limits(current.modelId);
	const data = [...ids].map((modelId) => {
		const info = listed.find((model) => model.id === modelId) as
			| { name?: string; supportsVision?: boolean }
			| undefined;
		const own = modelId === current.modelId ? currentLimits : undefined;
		return {
			id: fxModelId(modelId),
			object: "model",
			created: 0,
			owned_by: current.provider,
			name: info?.name ?? modelId,
			type: "language",
			tags: ["tool-use", ...(info?.supportsVision ? ["vision"] : [])],
			...(own?.context ? { context_window: own.context } : {}),
			...(own?.output ? { max_tokens: own.output } : {}),
		};
	});
	const chat = {
		...data[0],
		id: FX_CHAT_MODEL,
		name: `Chat model (${current.modelId})`,
	};
	return json(200, { object: "list", data: [chat, ...data] });
};

const requestUrl = (input: RequestInfo | URL): URL =>
	new URL(
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url,
	);

const bodyText = async (
	input: RequestInfo | URL,
	init: RequestInit | undefined,
): Promise<string> => {
	const body = init?.body;
	if (typeof body === "string") return body;
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		return new TextDecoder().decode(body);
	}
	if (body instanceof Blob) return body.text();
	if (typeof input !== "string" && !(input instanceof URL)) return input.text();
	return "";
};

/** The `fetch` the fx terminal runs with. */
export const createFxGatewayFetch =
	(options: FxGatewayOptions): typeof fetch =>
	async (input, init) => {
		const url = requestUrl(input);
		if (url.origin !== FX_GATEWAY_ORIGIN) {
			return failure(
				403,
				`fx in MemonOS reaches models through Memorall only; ${url.origin} is not available.`,
			);
		}
		const method = (init?.method ?? "GET").toUpperCase();
		const headers = new Headers(init?.headers);
		try {
			if (method === "POST" && url.pathname.endsWith("/ai/language-model")) {
				return await answerModelCall(
					options,
					headers,
					await bodyText(input, init),
					init?.signal ?? undefined,
				);
			}
			if (method === "GET" && url.pathname.endsWith("/v1/models")) {
				return await answerCatalog(options);
			}
		} catch (error) {
			return failure(
				502,
				error instanceof Error ? error.message : String(error),
			);
		}
		return failure(404, `${url.pathname} is not served in MemonOS.`);
	};
