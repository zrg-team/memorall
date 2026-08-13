import { reply } from "../../utils/common.js";
import { withGPULock } from "../../utils/gpu-lock.js";
import {
	AUTO_MAX_NEW_TOKENS_FLOOR,
	AUTO_MAX_NEW_TOKENS_SOFT_CAP,
	DEFAULT_MAX_NEW_TOKENS,
	UNKNOWN_MEMORY_AUTO_MAX_NEW_TOKENS,
} from "./constants.js";
import {
	getPromptLength,
	resolveMaxContextTokens,
	resolveMemoryContextTokens,
} from "./context-window.js";
import { getModelRuntimeConfig } from "./catalog.js";
import { getTransformersContext } from "./context.js";
import { buildModelInputs } from "./input-builder.js";
import {
	decodeTrimmedSequences,
	isRecoverableWebGPUExecutionError,
	trimSequences,
} from "./generation-utils.js";
import {
	createCompletionResponse,
	createStreamChunk,
	createStreamEndChunk,
	emitPostprocessedDelta,
} from "./responses.js";
import { postprocessGeneratedText, roundTokenCount } from "./text-utils.js";

function resolveEffectiveMaxTokens({
	defaultMaxNewTokens,
	maxTokens,
	promptLength,
	maxContextTokens,
	memoryContextTokens,
	webgpuMaxContext,
	memoryHint,
}) {
	const contextCandidates = [
		maxContextTokens,
		memoryContextTokens,
		webgpuMaxContext,
	].filter((v) => typeof v === "number");
	const maxTotalContextTokens =
		contextCandidates.length > 0 ? Math.min(...contextCandidates) : undefined;
	const maxNewTokensLimit =
		typeof maxTotalContextTokens === "number"
			? Math.max(0, maxTotalContextTokens - promptLength)
			: undefined;

	const defaultAutoMaxTokens = memoryHint
		? defaultMaxNewTokens
		: Math.min(defaultMaxNewTokens, UNKNOWN_MEMORY_AUTO_MAX_NEW_TOKENS);
	const suggestedAutoMaxTokens =
		typeof maxNewTokensLimit === "number"
			? Math.min(
					maxNewTokensLimit,
					Math.max(
						defaultAutoMaxTokens,
						Math.min(
							AUTO_MAX_NEW_TOKENS_SOFT_CAP,
							roundTokenCount(maxNewTokensLimit * 0.5),
						),
						Math.min(AUTO_MAX_NEW_TOKENS_FLOOR, maxNewTokensLimit),
					),
				)
			: defaultAutoMaxTokens;
	const requestedMaxTokens =
		typeof maxTokens === "number" && Number.isFinite(maxTokens)
			? maxTokens
			: suggestedAutoMaxTokens;

	if (typeof maxTokens !== "number" && typeof maxNewTokensLimit === "number") {
		console.log("[transformer-runner] auto max_new_tokens", {
			auto: true,
			max_new_tokens: requestedMaxTokens,
			defaultAutoMaxTokens,
			suggestedAutoMaxTokens,
			promptLength,
			maxContextTokens,
			memoryContextTokens,
			availableGB: memoryHint?.availableGB,
			hasMemoryHint: Boolean(memoryHint),
		});
	}

	const effectiveMaxNewTokens =
		typeof maxNewTokensLimit === "number" && typeof requestedMaxTokens === "number"
			? Math.min(requestedMaxTokens, maxNewTokensLimit)
			: requestedMaxTokens;

	if (
		typeof requestedMaxTokens === "number" &&
		typeof effectiveMaxNewTokens === "number" &&
		effectiveMaxNewTokens < requestedMaxTokens
	) {
		console.log("[transformer-runner] clamped max_new_tokens", {
			requested: requestedMaxTokens,
			effective: effectiveMaxNewTokens,
			promptLength,
			maxContextTokens,
			memoryContextTokens,
			availableGB: memoryHint?.availableGB,
			hasMemoryHint: Boolean(memoryHint),
		});
	}

	if (typeof maxNewTokensLimit === "number" && maxNewTokensLimit <= 0) {
		if (
			typeof webgpuMaxContext === "number" &&
			promptLength > webgpuMaxContext
		) {
			throw new Error(
				`Prompt is too long for WebGPU execution (promptLength=${promptLength}, webgpuMaxContextTokens=${webgpuMaxContext}). ` +
					`Reduce the conversation history or retrieved context to fit within ${webgpuMaxContext} tokens.`,
			);
		}

		if (
			typeof memoryContextTokens === "number" &&
			(typeof maxContextTokens !== "number" ||
				memoryContextTokens <= maxContextTokens)
		) {
			throw new Error(
				`Prompt is too long for available device memory (promptLength=${promptLength}, memoryContextTokens=${memoryContextTokens}, availableGB=${memoryHint?.availableGB ?? "unknown"})`,
			);
		}

		throw new Error(
			`Prompt is too long for the model context window (promptLength=${promptLength}, maxContextTokens=${maxTotalContextTokens ?? maxContextTokens})`,
		);
	}

	return effectiveMaxNewTokens;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	const error = new Error("Operation aborted");
	error.name = "AbortError";
	throw error;
}

function createInterruptableStoppingCriteria(signal) {
	if (!signal) {
		return { criteria: undefined, dispose: () => {} };
	}

	const InterruptableStoppingCriteria =
		getTransformersContext().transformers?.InterruptableStoppingCriteria;
	if (!InterruptableStoppingCriteria) {
		return { criteria: undefined, dispose: () => {} };
	}

	const criterion = new InterruptableStoppingCriteria();
	const interrupt = () => criterion.interrupt();
	if (signal.aborted) {
		interrupt();
	} else {
		signal.addEventListener("abort", interrupt, { once: true });
	}

	return {
		criteria: [criterion],
		dispose: () => signal.removeEventListener("abort", interrupt),
	};
}

async function runGeneration({
	bundle,
	targetModel,
	src,
	origin,
	messageId,
	messages,
	stream,
	maxTokens,
	temperature,
	topP,
	topK,
	tools,
	toolChoice,
	memoryHint,
	signal,
}) {
	const { TextStreamer } = getTransformersContext();
	const {
		model: currentModel,
		tokenizer: currentTokenizer,
		runtime,
		generator,
		defaultMaxNewTokens = DEFAULT_MAX_NEW_TOKENS,
	} = bundle;

	const input = await buildModelInputs(bundle, messages, tools, toolChoice);

	const promptLength = getPromptLength(input);
	const detectedMaxContextTokens = resolveMaxContextTokens(
		currentTokenizer,
		currentModel?.config,
	);
	const maxContextTokens =
		typeof detectedMaxContextTokens === "number"
			? detectedMaxContextTokens
			: typeof memoryHint?.contextLength === "number"
				? memoryHint.contextLength
				: undefined;
	const memoryContextTokens = resolveMemoryContextTokens(memoryHint);
	const runtimeCfg = getModelRuntimeConfig(targetModel);
	const webgpuMaxContext =
		bundle.device === "webgpu" &&
		typeof runtimeCfg?.webgpuMaxContextTokens === "number"
			? runtimeCfg.webgpuMaxContextTokens
			: undefined;

	const effectiveMaxNewTokens = resolveEffectiveMaxTokens({
		defaultMaxNewTokens,
		maxTokens,
		promptLength,
		maxContextTokens,
		memoryContextTokens,
		webgpuMaxContext,
		memoryHint,
	});
	const interruptableStoppingCriteria = createInterruptableStoppingCriteria(
		signal,
	);
	const generationAbortOptions = interruptableStoppingCriteria.criteria
		? { stopping_criteria: interruptableStoppingCriteria.criteria }
		: {};

	try {
		throwIfAborted(signal);

		if (stream) {
		if (runtime === "text_generation_pipeline") {
			const streamer = new TextStreamer(currentTokenizer, {
				skip_prompt: true,
				skip_special_tokens: true,
				callback_function: (token) => {
					throwIfAborted(signal);
					reply(
						src,
						origin,
						messageId,
						"stream_chunk",
						createStreamChunk(targetModel, token),
					);
				},
			});

			await generator(messages, {
				...(typeof effectiveMaxNewTokens === "number"
					? { max_new_tokens: effectiveMaxNewTokens }
					: {}),
				do_sample: temperature > 0,
				streamer,
					temperature,
					top_p: topP,
					top_k: topK,
					...generationAbortOptions,
				});
		} else {
			const postprocessState = {
				rawText: "",
				cleanedText: "",
			};
			const streamer = new TextStreamer(currentTokenizer, {
				skip_prompt: true,
				skip_special_tokens: bundle.postprocess !== "gemma_clean",
				callback_function: (token) => {
					throwIfAborted(signal);
					if (bundle.postprocess && bundle.postprocess !== "none") {
						emitPostprocessedDelta(
							targetModel,
							src,
							origin,
							messageId,
							token,
							postprocessState,
							bundle,
						);
						return;
					}

					reply(
						src,
						origin,
						messageId,
						"stream_chunk",
						createStreamChunk(targetModel, token),
					);
				},
			});

			await currentModel.generate({
				...input,
				...(typeof effectiveMaxNewTokens === "number"
					? { max_new_tokens: effectiveMaxNewTokens }
					: {}),
				do_sample: temperature > 0,
				streamer,
				return_dict_in_generate: true,
					temperature,
					top_p: topP,
					top_k: topK,
					...generationAbortOptions,
				});
		}

		throwIfAborted(signal);
		reply(src, origin, messageId, "stream_end", createStreamEndChunk(targetModel));
		return;
	}

	let decoded = "";
	let usage = {
		prompt_tokens: promptLength,
		completion_tokens: 0,
		total_tokens: promptLength,
	};

	if (runtime === "text_generation_pipeline") {
		let outputText = "";
		const streamer = new TextStreamer(currentTokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (token) => {
				throwIfAborted(signal);
				outputText += token;
			},
		});

		await generator(messages, {
			...(typeof effectiveMaxNewTokens === "number"
				? { max_new_tokens: effectiveMaxNewTokens }
				: {}),
			do_sample: temperature > 0,
			streamer,
			temperature,
			top_p: topP,
			top_k: topK,
			...generationAbortOptions,
		});
		throwIfAborted(signal);

		decoded = postprocessGeneratedText(outputText, bundle);
	} else if (bundle.postprocess && bundle.postprocess !== "none") {
		let outputText = "";
		const streamer = new TextStreamer(currentTokenizer, {
			skip_prompt: true,
			skip_special_tokens: false,
			callback_function: (token) => {
				throwIfAborted(signal);
				outputText += token;
			},
		});

		await currentModel.generate({
			...input,
			...(typeof effectiveMaxNewTokens === "number"
				? { max_new_tokens: effectiveMaxNewTokens }
				: {}),
			do_sample: temperature > 0,
			streamer,
			temperature,
			top_p: topP,
			top_k: topK,
			...generationAbortOptions,
		});
		throwIfAborted(signal);

		decoded = postprocessGeneratedText(outputText, bundle);
	} else {
		const generationResult = await currentModel.generate({
			...input,
			...(typeof effectiveMaxNewTokens === "number"
				? { max_new_tokens: effectiveMaxNewTokens }
				: {}),
			do_sample: temperature > 0,
			return_dict_in_generate: true,
			temperature,
			top_p: topP,
			top_k: topK,
			...generationAbortOptions,
		});
		throwIfAborted(signal);

		const trimmedSeq = trimSequences(generationResult.sequences, promptLength);
		decoded = postprocessGeneratedText(
			decodeTrimmedSequences(currentTokenizer, trimmedSeq),
			bundle,
		);

		const totalTokens = generationResult.sequences?.dims?.[1] || promptLength;
		usage = {
			prompt_tokens: promptLength,
			completion_tokens: totalTokens - promptLength,
			total_tokens: totalTokens,
		};
	}

	reply(
		src,
		origin,
		messageId,
		"complete",
		createCompletionResponse(targetModel, decoded, usage),
	);
	} finally {
		interruptableStoppingCriteria.dispose();
	}
}

export async function executeChatCompletion({
	transformerManager,
	targetModel,
	src,
	origin,
	messageId,
	payload,
	signal,
}) {
	const {
		messages,
		stream = false,
		max_tokens,
		temperature = 0,
		top_p = 1,
		top_k = 50,
		tools,
		tool_choice,
		_memoryHint,
	} = payload || {};

	await transformerManager.withModel(targetModel, async (bundle) => {
		await withGPULock(async () => {
			await runGeneration({
				bundle,
				targetModel,
				src,
				origin,
				messageId,
				messages,
				stream,
				maxTokens: max_tokens,
				temperature,
				topP: top_p,
				topK: top_k,
				tools,
				toolChoice: tool_choice,
				memoryHint: _memoryHint,
				signal,
			});
		});
	});
}

export { isRecoverableWebGPUExecutionError };
