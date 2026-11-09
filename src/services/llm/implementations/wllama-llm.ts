import { LLM_RUNNER_URLS } from "@/config/llm-runner";
import { detectSystemSpecs } from "@/main/modules/llm/utils/system-detection";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import { waitForDOMReady } from "@/utils/dom";
import type {
	RealtimeResponseCreateParams,
	RealtimeResponseStreamEvent,
	RealtimeSessionCloseParams,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	SystemOneParams,
	SystemOneResponse,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import { normalizeSystemOneResponse } from "../utils/decision-schema";
import { AsyncEventQueue } from "../utils/async-event-queue";
import {
	PcmChunkBatcher,
	base64ToBytes,
	bytesToBase64,
	concatFloat32,
	encodeWav,
	float32ToPcm16,
	pcm16ToFloat32,
} from "../utils/media-encoding";
import { mediaPayloadToBytes } from "../utils/media-payload";
import type {
	BaseLLM,
	LLMInfo,
	ModelInfo,
	ModelsResponse,
} from "../interfaces/base-llm";
import type { ToolCapabilityInfo } from "../interfaces/tool-capability";
import { NO_TOOL_SUPPORT } from "../interfaces/tool-capability";
import { getModel } from "../registry/model-registry";
import {
	extractToolCallsFromResponse,
	PromptToolStreamTransformer,
	preparePromptToolRequest,
} from "../tools/tool-adapter";
import {
	getWllamaToolCapabilities,
	WLLAMA_NATIVE_TOOL_SUPPORT,
} from "../tools/tool-capability-resolver";
import {
	buildRunnerMemoryHint,
	type RunnerMemoryHint,
} from "../utils/runner-memory-hints";
import {
	chunkHasFinishReason,
	extractChunkOutputText,
	extractResponseOutputText,
	normalizeTokenUsage,
	resolveTokenUsage,
} from "../utils/token-usage";
import { IframeRuntime } from "./iframe-runtime";

interface ServeRequest {
	model: string;
}

interface UnloadRequest {
	model: string;
}

interface DeleteRequest {
	model: string;
}

interface ProgressEvent {
	loaded: number;
	total: number;
	percent: number;
}

interface BaseMessage {
	messageId: string;
}

interface OutgoingMessage extends BaseMessage {
	type:
		| "init"
		| "serve"
		| "models"
		| "chat/completions"
		| "systemone"
		| "audio/speech"
		| "audio/transcriptions"
		| "realtime/response"
		| "realtime/close"
		| "unload"
		| "delete";
	payload?: unknown;
}

interface IncomingMessage extends BaseMessage {
	type:
		| "ready"
		| "complete"
		| "error"
		| "progress"
		| "stream_chunk"
		| "stream_end";
	payload?: unknown;
}

interface ErrorResponse {
	error: {
		message: string;
		type: string;
		code: string | null;
	};
}

interface DetectedCapabilities {
	supportsDecisions?: boolean;
	supportsNativeTools: boolean;
	supportsVision: boolean;
	supportsAudio: boolean;
	usesGPU: boolean;
}

/** Each runner stream has its own chunk shape, so handlers name their own. */
type StreamChunkHandler = (chunk: never) => void;

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	onProgress?: (progress: ProgressEvent) => void;
	onStreamChunk?: StreamChunkHandler;
	signalId?: string;
};

/**
 * Requests whose cancellation is finished only when the runner says so. The
 * residency lease must not unload a model that is still winding one down.
 */
const AWAITS_RUNNER_ON_ABORT: ReadonlySet<OutgoingMessage["type"]> = new Set([
	"systemone",
	"audio/speech",
	"audio/transcriptions",
	"realtime/response",
]);

/** Short batches: a spoken reply should start as soon as it can. */
const REALTIME_AUDIO_BATCH_MS = 200;

export class WllamaLLM implements BaseLLM {
	name = "wllama";
	private iframe: HTMLIFrameElement | null = null;
	private ready = false;
	private loading = false;
	private pending = new Map<string, PendingRequest>();
	private signalMap = new Map<string, AbortSignal>();
	private modelCapabilities = new Map<string, DetectedCapabilities>();
	private systemSpecsPromise: Promise<Awaited<
		ReturnType<typeof detectSystemSpecs>
	> | null> | null = null;
	private url: string;
	private iframeRuntime: IframeRuntime;

	constructor(url = LLM_RUNNER_URLS?.wllama) {
		this.url = url;
		this.iframeRuntime = new IframeRuntime({
			provider: this.name,
			ensureReady: () => this.initialize(),
			isReady: () => this.ready,
			destroyIframe: () => this.destroy(),
			fetchModels: () => this.send("models") as Promise<ModelsResponse>,
		});
	}

	async initialize(): Promise<void> {
		if (this.ready) return;
		if (this.loading) {
			while (this.loading) await new Promise((r) => setTimeout(r, 50));
			return;
		}
		this.loading = true;
		try {
			// Wait for DOM to be ready before accessing document
			await waitForDOMReady();
			this.iframe = document.createElement("iframe");
			this.iframe.src = this.url;
			this.iframe.style.display = "none";
			document.body.appendChild(this.iframe);

			window.addEventListener("message", this.onMessage);

			await new Promise<void>((resolve) => {
				const handler = (e: MessageEvent<IncomingMessage>) => {
					if (e.data?.messageId === "RUNNER_READY") {
						const isFromRunner = e.source === this.iframe?.contentWindow;
						if (isFromRunner) {
							window.removeEventListener("message", handler);
							resolve();
						}
					}
				};
				window.addEventListener("message", handler);
			});

			await this.send("init");
			this.ready = true;
		} catch (error) {
			this.destroy();
			throw error;
		} finally {
			this.loading = false;
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	async getMaxModelTokens(model?: string): Promise<number> {
		return getModel(model ?? "", "wllama")?.contextLength ?? 8192;
	}

	async getMaxResponseTokens(model?: string): Promise<number> {
		return getModel(model ?? "", "wllama")?.defaultMaxNewTokens ?? 1024;
	}

	async models(): Promise<ModelsResponse> {
		const response =
			(await this.iframeRuntime.cachedModelsWhenNotCurrent()) ??
			(await this.iframeRuntime.run(() => this.iframeRuntime.refreshModels()));
		return {
			...response,
			data: response.data.map((model) => ({
				...model,
				categories:
					getModel(model.id, "wllama")?.categories ?? model.categories,
			})),
		};
	}

	async systemOne(request: SystemOneParams): Promise<SystemOneResponse> {
		let signalId: string | undefined;
		this.iframeRuntime.beginOperation();
		try {
			if (!this.ready) await this.initialize();
			const { signal, ...payload } = request;
			if (signal) {
				signalId = Math.random().toString(36).slice(2);
				this.signalMap.set(signalId, signal);
			}
			const result = await this.send(
				"systemone",
				{
					...payload,
					_memoryHint: await this.getRunnerMemoryHint(request.model),
				},
				{ signalId },
			);
			return normalizeSystemOneResponse(result, request.model);
		} finally {
			if (signalId) this.signalMap.delete(signalId);
			await this.iframeRuntime.finishOperation();
		}
	}

	/** Run one speech request in the runner, loading its model if needed. */
	private async runSpeechRequest<Chunk>(
		type: OutgoingMessage["type"],
		payload: { model: string } & Record<string, unknown>,
		options: { signal?: AbortSignal; onChunk: (chunk: Chunk) => void },
	): Promise<unknown> {
		let signalId: string | undefined;
		this.iframeRuntime.beginOperation();
		try {
			if (!this.ready) await this.initialize();
			if (options.signal) {
				signalId = Math.random().toString(36).slice(2);
				this.signalMap.set(signalId, options.signal);
			}
			return await this.send(type, await this.withRunnerMemoryHint(payload), {
				onStreamChunk: options.onChunk,
				signalId,
			});
		} finally {
			if (signalId) this.signalMap.delete(signalId);
			await this.iframeRuntime.finishOperation();
		}
	}

	async audioSpeech(request: SpeechCreateParams): Promise<SpeechResponse> {
		let result: SpeechResponse | null = null;
		for await (const event of this.audioSpeechStream(request)) {
			if (event.type === "speech.audio.done") result = event.result;
		}
		if (!result) throw new Error("Speech synthesis produced no audio");
		return result;
	}

	audioSpeechStream(
		request: SpeechCreateParams,
	): AsyncIterableIterator<SpeechStreamEvent> {
		const queue = new AsyncEventQueue<SpeechStreamEvent>();
		const frames: Float32Array[] = [];
		const batcherRef: { current: PcmChunkBatcher | null } = { current: null };
		let sampleRate = 0;
		let seq = 0;

		const emit = (samples: Float32Array | null) => {
			if (!samples) return;
			queue.push({
				type: "speech.audio.delta",
				audio: bytesToBase64(float32ToPcm16(samples)),
				sample_rate: sampleRate,
				seq: seq++,
			});
		};

		void (async () => {
			const { signal, ...wire } = request;
			await this.runSpeechRequest<{ pcm: Float32Array; sampleRate: number }>(
				"audio/speech",
				wire,
				{
					signal,
					onChunk: ({ pcm, sampleRate: rate }) => {
						sampleRate = rate;
						batcherRef.current ??= new PcmChunkBatcher(rate);
						frames.push(pcm);
						emit(batcherRef.current.push(pcm));
					},
				},
			);
			emit(batcherRef.current?.flush() ?? null);
			const samples = concatFloat32(frames);
			if (samples.length === 0) {
				throw new Error("Speech synthesis produced no audio");
			}
			queue.push({
				type: "speech.audio.done",
				result: {
					object: "audio.speech",
					model: request.model,
					voice: request.voice,
					sample_rate: sampleRate,
					duration_ms: Math.round((samples.length / sampleRate) * 1000),
					audio: {
						kind: "bytes",
						bytes: encodeWav(samples, sampleRate),
						mimeType: "audio/wav",
					},
					usage: { input_characters: request.input.length },
				},
			});
			queue.end();
		})().catch((error) => queue.fail(error));

		return queue;
	}

	async audioTranscriptions(
		request: TranscriptionCreateParams,
	): Promise<Transcription> {
		let result: Transcription | null = null;
		for await (const event of this.audioTranscriptionsStream(request)) {
			if (event.type === "transcript.text.done") result = event.result;
		}
		if (!result) throw new Error("Transcription produced no result");
		return result;
	}

	audioTranscriptionsStream(
		request: TranscriptionCreateParams,
	): AsyncIterableIterator<TranscriptionStreamEvent> {
		const queue = new AsyncEventQueue<TranscriptionStreamEvent>();

		void (async () => {
			const bytes = await mediaPayloadToBytes(request.file);
			const { signal, file: _file, ...wire } = request;
			const result = (await this.runSpeechRequest<{ delta: string }>(
				"audio/transcriptions",
				{ ...wire, audio: bytes.slice().buffer },
				{
					signal,
					onChunk: ({ delta }) => {
						queue.push({ type: "transcript.text.delta", delta });
					},
				},
			)) as Transcription;
			queue.push({ type: "transcript.text.done", result });
			queue.end();
		})().catch((error) => queue.fail(error));

		return queue;
	}

	realtimeResponse(
		request: RealtimeResponseCreateParams,
	): AsyncIterableIterator<RealtimeResponseStreamEvent> {
		const queue = new AsyncEventQueue<RealtimeResponseStreamEvent>();
		const frames: Float32Array[] = [];
		const batcherRef: { current: PcmChunkBatcher | null } = { current: null };
		let sampleRate = 0;
		let seq = 0;

		const emit = (samples: Float32Array | null) => {
			if (!samples) return;
			queue.push({
				type: "response.output_audio.delta",
				audio: bytesToBase64(float32ToPcm16(samples)),
				sample_rate: sampleRate,
				seq: seq++,
			});
		};

		void (async () => {
			const bytes = await mediaPayloadToBytes(request.audio);
			const { signal, audio: _audio, ...wire } = request;
			const { text } = (await this.runSpeechRequest<
				| { type: "text"; delta: string }
				| { type: "audio"; delta: string; sampleRate: number }
			>(
				"realtime/response",
				{ ...wire, audio: bytes.slice().buffer },
				{
					signal,
					onChunk: (chunk) => {
						if (chunk.type === "text") {
							queue.push({
								type: "response.output_text.delta",
								delta: chunk.delta,
							});
							return;
						}
						sampleRate = chunk.sampleRate;
						const samples = pcm16ToFloat32(base64ToBytes(chunk.delta));
						batcherRef.current ??= new PcmChunkBatcher(
							sampleRate,
							REALTIME_AUDIO_BATCH_MS,
						);
						frames.push(samples);
						emit(batcherRef.current.push(samples));
					},
				},
			)) as { text: string };
			emit(batcherRef.current?.flush() ?? null);
			const samples = concatFloat32(frames);
			queue.push({
				type: "response.done",
				result: {
					object: "realtime.response",
					model: request.model,
					session: request.session,
					text,
					...(samples.length > 0
						? {
								audio: {
									kind: "bytes" as const,
									bytes: encodeWav(samples, sampleRate),
									mimeType: "audio/wav",
								},
								sample_rate: sampleRate,
								duration_ms: Math.round((samples.length / sampleRate) * 1000),
							}
						: {}),
				},
			});
			queue.end();
		})().catch((error) => queue.fail(error));

		return queue;
	}

	async closeRealtimeSession(
		request: RealtimeSessionCloseParams,
	): Promise<void> {
		// A runner that is not running holds no sessions.
		if (!this.ready) return;
		await this.send("realtime/close", request);
	}

	chatCompletions(
		request: ChatCompletionRequest & { stream?: false },
	): Promise<ChatCompletionResponse>;
	chatCompletions(
		request: ChatCompletionRequest & { stream: true },
	): AsyncIterableIterator<ChatCompletionChunk>;
	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (request.stream) {
			return this.createStreamingCompletion(request);
		} else {
			return this.createCompletion(request);
		}
	}

	private async createCompletion(
		request: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> {
		let signalId: string | undefined;
		this.iframeRuntime.beginOperation();

		try {
			if (!this.ready) await this.initialize();

			const capability = await this.getToolCapabilities(request.model);
			const shouldNormalizePromptMessages =
				capability.mode === "prompt_injection";
			const usePromptToolParsing =
				shouldNormalizePromptMessages && !!request.tools?.length;
			const processedRequest = shouldNormalizePromptMessages
				? preparePromptToolRequest(request)
				: request;

			const {
				signal,
				tools,
				tool_choice,
				parallel_tool_calls,
				...basePayload
			} = processedRequest;

			// Pass tools to the runner only when the model natively supports them
			const requestPayload =
				capability.mode === "native"
					? { ...basePayload, tools, tool_choice }
					: basePayload;

			if (signal) {
				signalId = Math.random().toString(36).slice(2);
				this.signalMap.set(signalId, signal);
			}
			const payloadWithHints = await this.withRunnerMemoryHint(requestPayload);

			let response = (await this.send("chat/completions", payloadWithHints, {
				signalId,
			})) as ChatCompletionResponse;

			response = {
				...response,
				usage: resolveTokenUsage(
					response.usage,
					processedRequest.messages,
					extractResponseOutputText(response),
				),
			};

			if (usePromptToolParsing) {
				response = extractToolCallsFromResponse(response);
			}

			return response;
		} finally {
			if (signalId) {
				this.signalMap.delete(signalId);
			}
			await this.iframeRuntime.finishOperation();
		}
	}

	private async *createStreamingCompletion(
		request: ChatCompletionRequest,
	): AsyncIterableIterator<ChatCompletionChunk> {
		let signalId: string | undefined;
		this.iframeRuntime.beginOperation();

		try {
			if (!this.ready) await this.initialize();

			const capability = await this.getToolCapabilities(request.model);
			const shouldNormalizePromptMessages =
				capability.mode === "prompt_injection";
			const usePromptToolParsing =
				shouldNormalizePromptMessages && !!request.tools?.length;
			const processedRequest = shouldNormalizePromptMessages
				? preparePromptToolRequest(request)
				: request;

			const {
				signal,
				tools,
				tool_choice,
				parallel_tool_calls,
				...basePayload
			} = processedRequest;

			// Pass tools to the runner only when the model natively supports them
			const requestPayload =
				capability.mode === "native"
					? { ...basePayload, tools, tool_choice }
					: basePayload;

			if (signal) {
				signalId = Math.random().toString(36).slice(2);
				this.signalMap.set(signalId, signal);
			}
			const payloadWithHints = await this.withRunnerMemoryHint(requestPayload);

			const chunks: ChatCompletionChunk[] = [];
			let streamEnded = false;
			let streamError: Error | null = null;
			let completionOutput = "";
			let finalUsage = normalizeTokenUsage(undefined);
			const promptToolTransformer = usePromptToolParsing
				? new PromptToolStreamTransformer()
				: null;

			const chunkHandler = (incomingChunk: ChatCompletionChunk) => {
				const usage = normalizeTokenUsage(incomingChunk.usage);
				if (usage) {
					finalUsage = usage;
				}

				completionOutput += extractChunkOutputText(incomingChunk);

				const chunk =
					!usage && !finalUsage && chunkHasFinishReason(incomingChunk)
						? {
								...incomingChunk,
								usage: resolveTokenUsage(
									undefined,
									processedRequest.messages,
									completionOutput,
								),
							}
						: usage
							? { ...incomingChunk, usage }
							: incomingChunk;

				if (!promptToolTransformer) {
					chunks.push(chunk);
					return;
				}

				chunks.push(...promptToolTransformer.ingest(chunk));
			};

			const streamPromise = this.send("chat/completions", payloadWithHints, {
				onStreamChunk: chunkHandler,
				signalId,
			}).catch((error) => {
				streamError = error;
				streamEnded = true;
			});

			// Wait for chunks to arrive
			while (!streamEnded && !streamError) {
				if (chunks.length > 0) {
					const chunk = chunks.shift()!;
					yield chunk;
					if (chunk.choices[0]?.finish_reason) {
						streamEnded = true;
					}
				} else {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}

			// Yield any remaining chunks
			while (chunks.length > 0) {
				yield chunks.shift()!;
			}

			if (promptToolTransformer) {
				for (const chunk of promptToolTransformer.flush()) {
					yield chunk;
				}
			}

			if (streamError) {
				throw streamError;
			}

			await streamPromise;
		} finally {
			if (signalId) {
				this.signalMap.delete(signalId);
			}
			await this.iframeRuntime.finishOperation();
		}
	}

	async unload(modelId: string): Promise<void> {
		this.iframeRuntime.beginOperation();
		try {
			if (!this.ready) await this.initialize();
			const parts = modelId.split("/");
			if (parts.length < 3) {
				throw new Error('Model ID must be in format "username/repo/filename"');
			}
			const request: UnloadRequest = { model: modelId };
			await this.send("unload", request);
			await this.iframeRuntime.refreshModelsAfterMutation();
		} finally {
			await this.iframeRuntime.finishOperation();
		}
	}

	async delete(modelId: string): Promise<void> {
		this.iframeRuntime.beginOperation();
		try {
			if (!this.ready) await this.initialize();
			const parts = modelId.split("/");
			if (parts.length < 3) {
				throw new Error('Model ID must be in format "username/repo/filename"');
			}
			const request: DeleteRequest = { model: modelId };
			await this.send("delete", request);
			await this.iframeRuntime.refreshModelsAfterMutation();
		} finally {
			await this.iframeRuntime.finishOperation();
		}
	}

	async getToolCapabilities(model?: string): Promise<ToolCapabilityInfo> {
		const detected = model ? this.modelCapabilities.get(model) : undefined;
		if (
			detected?.supportsDecisions ||
			getModel(model ?? "", "wllama")?.wllamaConfig?.runtime === "decision"
		) {
			return NO_TOOL_SUPPORT;
		}
		if (detected?.supportsNativeTools) {
			return WLLAMA_NATIVE_TOOL_SUPPORT;
		}
		return getWllamaToolCapabilities();
	}

	async supportsTools(model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilities(model);
		return capability.supported;
	}

	getInfo(): LLMInfo {
		return {
			name: this.name,
			type: "wllama",
			ready: this.ready,
		};
	}

	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		let keepAlive = false;
		this.iframeRuntime.beginOperation();
		try {
			if (!this.ready) await this.initialize();
			const parts = model.split("/");
			if (parts.length < 3) {
				throw new Error('Model must be in format "username/repo/filename"');
			}

			// Avoid reloading a model that's already active inside the runner
			const existingModels = await this.iframeRuntime.refreshModels();
			const existingModel = existingModels.data.find(
				(m) => m.loaded && m.id.toLowerCase() === model.toLowerCase(),
			);
			if (existingModel) {
				if (onProgress) {
					onProgress({
						loaded: existingModel.size ?? 0,
						total: existingModel.size ?? 0,
						percent: 100,
					});
				}
				// Same warm-path gap as the transformer runner: without this a
				// model carried over from an earlier session loses its detected
				// native tool support and silently degrades to prompt injection.
				if (!this.modelCapabilities.has(model)) {
					this.modelCapabilities.set(model, {
						supportsDecisions: existingModel.categories?.includes("decision"),
						supportsNativeTools: existingModel.supportsNativeTools === true,
						supportsVision: existingModel.supportsVision === true,
						supportsAudio: existingModel.supportsAudio === true,
						// ModelInfo carries no GPU flag; the runner reports it only on a
						// fresh serve, and it does not affect tool capability.
						usesGPU: false,
					});
				}
				keepAlive = await this.iframeRuntime.shouldKeepAliveFor(existingModel);
				return existingModel;
			}

			const request: ServeRequest = { model };
			const response = (await this.send(
				"serve",
				await this.withRunnerMemoryHint(request),
				{ onProgress },
			)) as ModelInfo & { capabilities?: DetectedCapabilities };

			const modelInfo = this.iframeRuntime.upsertCachedModel(response);
			keepAlive = await this.iframeRuntime.shouldKeepAliveFor(modelInfo);

			if (response.capabilities) {
				this.modelCapabilities.set(model, response.capabilities);
			}

			return modelInfo;
		} finally {
			await this.iframeRuntime.finishOperation({ keepAlive });
		}
	}

	async loadModelFromHF(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<void> {
		const parts = model.split("/");
		if (parts.length < 3) {
			throw new Error('Model must be in format "username/repo/filename"');
		}

		await this.serve(model, onProgress);
	}

	private async withRunnerMemoryHint<Payload extends { model?: string }>(
		requestPayload: Payload,
	): Promise<
		Payload & {
			_memoryHint?: RunnerMemoryHint;
			_mmprojFile?: string;
			_decision?: boolean;
		}
	> {
		const memoryHint = await this.getRunnerMemoryHint(requestPayload.model);
		const config = getModel(requestPayload.model ?? "", "wllama")?.wllamaConfig;
		const mmprojFile = config?.mmprojFilename;
		const decision = config?.runtime === "decision";
		if (!memoryHint && mmprojFile === undefined && !decision) {
			return requestPayload;
		}

		return {
			...requestPayload,
			...(memoryHint ? { _memoryHint: memoryHint } : {}),
			...(mmprojFile !== undefined ? { _mmprojFile: mmprojFile } : {}),
			...(decision ? { _decision: true } : {}),
		};
	}

	private async getRunnerMemoryHint(
		modelId?: string,
	): Promise<RunnerMemoryHint | undefined> {
		const specs = await this.getSystemSpecs();
		return buildRunnerMemoryHint(modelId, "wllama", specs);
	}

	private async getSystemSpecs(): Promise<Awaited<
		ReturnType<typeof detectSystemSpecs>
	> | null> {
		if (!this.systemSpecsPromise) {
			this.systemSpecsPromise = detectSystemSpecs().catch(() => null);
		}

		return this.systemSpecsPromise;
	}

	destroy(): void {
		this.iframeRuntime.cancelIdleDestroy();
		this.iframe?.remove();
		this.iframe = null;
		window.removeEventListener("message", this.onMessage);
		this.pending.forEach(({ reject }) => {
			reject(new Error("Service destroyed"));
		});
		this.pending.clear();
		this.modelCapabilities.clear();
		this.ready = false;
		this.systemSpecsPromise = null;
	}

	private onMessage = (ev: MessageEvent<IncomingMessage>) => {
		const { messageId, type, payload } = ev.data || {};

		// CRITICAL: Only process messages from our own iframe to prevent cross-contamination
		const fromRunner = ev.source === this.iframe?.contentWindow;
		if (!fromRunner) {
			return;
		}

		if (!messageId) return;

		const pendingRequest = this.pending.get(messageId);
		if (!pendingRequest) return;

		if (type === "progress") {
			const progressData = payload as ProgressEvent;
			pendingRequest.onProgress?.(progressData);
			window.dispatchEvent(
				new CustomEvent("wllama:progress", { detail: progressData }),
			);
			return;
		}

		if (type === "stream_chunk") {
			pendingRequest.onStreamChunk?.(payload as never);
			return;
		}

		if (type === "stream_end") {
			this.pending.delete(messageId);
			pendingRequest.onStreamChunk?.(payload as never);
			pendingRequest.resolve(undefined);
			return;
		}

		this.pending.delete(messageId);

		if (type === "complete") {
			pendingRequest.resolve(payload);
		} else if (type === "error") {
			const errorData = payload as ErrorResponse;
			const error = new Error(errorData.error?.message || "Unknown error");
			pendingRequest.reject(error);
		}
	};

	private send(
		type: OutgoingMessage["type"],
		payload?: unknown,
		options?: {
			onProgress?: (progress: ProgressEvent) => void;
			onStreamChunk?: StreamChunkHandler;
			signalId?: string;
		},
	): Promise<unknown> {
		return this.iframeRuntime.serialize(() =>
			this.sendToRunner(type, payload, options),
		);
	}

	private sendToRunner(
		type: OutgoingMessage["type"],
		payload?: unknown,
		options?: {
			onProgress?: (progress: ProgressEvent) => void;
			onStreamChunk?: StreamChunkHandler;
			signalId?: string;
		},
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const target = this.iframe?.contentWindow;
			if (!target) return reject(new Error("Runner iframe not ready"));

			const id = Math.random().toString(36).slice(2);
			this.pending.set(id, {
				resolve,
				reject,
				onProgress: options?.onProgress,
				onStreamChunk: options?.onStreamChunk,
				signalId: options?.signalId,
			});

			if (options?.signalId) {
				const signal = this.signalMap.get(options.signalId);
				if (signal) {
					const abortHandler = () => {
						if (!AWAITS_RUNNER_ON_ABORT.has(type)) {
							this.pending.delete(id);
							reject(new Error("Operation aborted"));
						}
						target.postMessage({ messageId: id, type: "abort" }, "*");
					};

					if (signal.aborted) {
						this.pending.delete(id);
						reject(new Error("Operation aborted"));
						return;
					}

					signal.addEventListener("abort", abortHandler, { once: true });
				}
			}

			try {
				const message: OutgoingMessage = { messageId: id, type, payload };
				target.postMessage(message, "*");
			} catch (e) {
				this.pending.delete(id);
				reject(e);
			}
		});
	}
}
