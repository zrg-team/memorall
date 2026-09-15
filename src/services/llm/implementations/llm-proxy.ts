import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	BaseLLM,
	LLMInfo,
	LLMType,
	ModelInfo,
	ModelsResponse,
	ProgressEvent,
} from "../interfaces/base-llm";
import type {
	ServeOptions,
	ServiceProvider,
} from "../interfaces/llm-service.interface";
import type { ToolCapabilityInfo } from "../interfaces/tool-capability";
import { LLM_DOWNLOAD_PROGRESS_EVENT } from "../constants";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type {
	ItemHandlerResult,
	JobProgressEvent,
} from "@/services/background-jobs/handlers/types";
import {
	chunkHasFinishReason,
	extractChunkOutputText,
	extractResponseOutputText,
	normalizeTokenUsage,
	resolveTokenUsage,
} from "../utils/token-usage";
import { resolveToolCapabilitiesForLLM } from "../tools/tool-capability-resolver";
import { isAbortError } from "@/utils/abort";
import type {
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	MediaPayload,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import { persistMediaPayload } from "../utils/media-persistence";

const MEDIA_EVENT_METADATA_KEY = "mediaEvent";

/**
 * Inputs cross to the offscreen document as a documents-filesystem path, never
 * inline: extension messages are capped (64 MiB) and job payloads are stored
 * in IndexedDB, so a long recording must not travel as base64. The offscreen
 * side reads the file, retrying while its filesystem view catches up.
 */
async function toWirePayload(
	payload: MediaPayload,
): Promise<{ payload: MediaPayload; cleanup: () => void }> {
	if (payload.kind === "file") return { payload, cleanup: () => undefined };
	const stored = await persistMediaPayload(payload, {
		kind: payload.mimeType.startsWith("image/") ? "image" : "audio",
		folder: "inputs",
	});
	// Written only to cross the job channel; nothing references it afterwards.
	const cleanup = () =>
		void Promise.all([
			import("@/services/filesystem/document-filesystem"),
			import("@/services/filesystem/sandbox-paths"),
		])
			.then(([{ documentFileSystemService }, { toDocumentsSandboxPath }]) =>
				documentFileSystemService.deleteFile(
					toDocumentsSandboxPath(stored.path),
				),
			)
			.catch(() => undefined);
	return { payload: stored, cleanup };
}

// Proxy class for LLMs that exist in background jobs
export class LLMProxy implements BaseLLM {
	constructor(
		public readonly name: string,
		public readonly llmType: string,
	) {}

	private requestCancellation(jobId: string): void {
		void backgroundJob
			.execute(
				"cancel-chat-completion",
				{ targetJobId: jobId },
				{ stream: false },
			)
			.then(({ promise }) => promise.catch(() => undefined))
			.catch(() => undefined);
	}

	private bindAbortSignal(
		signal: AbortSignal | undefined,
		jobId: string,
	): () => void {
		if (!signal) return () => undefined;

		let cancellationRequested = false;
		const requestCancellation = () => {
			if (cancellationRequested) return;
			cancellationRequested = true;
			this.requestCancellation(jobId);
		};

		if (signal.aborted) {
			requestCancellation();
		} else {
			signal.addEventListener("abort", requestCancellation, { once: true });
		}

		return () => signal.removeEventListener("abort", requestCancellation);
	}

	private toBackgroundJobError(error: unknown): Error {
		if (isAbortError(error)) {
			return error instanceof Error
				? error
				: new DOMException("Operation aborted", "AbortError");
		}

		return new Error(`Background job failed: ${error}`);
	}

	async initialize(): Promise<void> {
		// Already initialized in background job
	}

	isReady(): boolean {
		// Assume ready since it was created successfully in background
		return true;
	}

	async getMaxModelTokens(model?: string): Promise<number> {
		try {
			const { promise } = await backgroundJob.execute(
				"get-max-model-tokens",
				{
					serviceName: this.name,
					model,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "completed" && result.result) {
				return result.result.maxModelTokens as number;
			}
			throw new Error(result.error || "Failed to get max model tokens");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async getMaxResponseTokens(model?: string): Promise<number> {
		try {
			const jobResponse = await backgroundJob.execute(
				"get-max-response-tokens",
				{
					serviceName: this.name,
					model,
				},
				{ stream: false },
			);

			if (!("promise" in jobResponse)) {
				throw new Error("Failed to get max response tokens");
			}
			const result = await jobResponse.promise;

			if (result.status === "completed" && result.result) {
				return result.result.maxResponseTokens;
			}
			throw new Error(result.error || "Failed to get max response tokens");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async models(): Promise<ModelsResponse> {
		try {
			const { promise } = await backgroundJob.execute(
				"get-models-for-service",
				{
					serviceName: this.name,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "completed" && result.result) {
				return result.result.models as ModelsResponse;
			}
			throw new Error(result.error || "Failed to get models");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
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
		// Extract signal from request (can't serialize AbortSignal)
		const { signal, ...requestPayload } = request;

		if (request.stream) {
			// Use execute with stream: true to get real-time streaming
			const self = this;
			return (async function* () {
				let completionOutput = "";
				let finalUsage = normalizeTokenUsage(undefined);

				try {
					const { jobId, stream } = await backgroundJob.execute(
						"chat-completion",
						{
							serviceName: self.name,
							request: { ...requestPayload, stream: true },
						},
						{ stream: true },
					);
					const removeAbortListener = self.bindAbortSignal(signal, jobId);

					try {
						// Stream chunks as they come from progress updates
						for await (const progressEvent of stream) {
							// If progress contains a chunk in metadata, yield it immediately
							if (progressEvent.metadata?.chunk) {
								const incomingChunk = progressEvent.metadata
									.chunk as ChatCompletionChunk;
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
													request.messages,
													completionOutput,
												),
											}
										: usage
											? { ...incomingChunk, usage }
											: incomingChunk;

								yield chunk;
							}

							if (progressEvent.status === "failed") {
								throw new Error(progressEvent.error || "Job failed");
							}
						}
					} finally {
						removeAbortListener();
					}
				} catch (error) {
					throw self.toBackgroundJobError(error);
				}
			})();
		} else {
			// Non-streaming request
			return (async () => {
				try {
					const { jobId, promise } = await backgroundJob.execute(
						"chat-completion",
						{
							serviceName: this.name,
							request: requestPayload,
						},
						{ stream: false },
					);
					const removeAbortListener = this.bindAbortSignal(signal, jobId);

					try {
						const result = await promise;

						if (
							result.status === "completed" &&
							result.result &&
							"response" in result.result
						) {
							const responseData = result.result as {
								response: ChatCompletionResponse;
							};
							return {
								...responseData.response,
								usage: resolveTokenUsage(
									responseData.response.usage,
									request.messages,
									extractResponseOutputText(responseData.response),
								),
							};
						}
						throw new Error(
							result.error || "Failed to process chat completion",
						);
					} finally {
						removeAbortListener();
					}
				} catch (error) {
					throw this.toBackgroundJobError(error);
				}
			})();
		}
	}

	async unload(modelId: string): Promise<void> {
		try {
			const { promise } = await backgroundJob.execute(
				"unload-model",
				{
					serviceName: this.name,
					modelId,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "failed") {
				throw new Error(result.error || "Failed to unload model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async delete(modelId: string): Promise<void> {
		try {
			const { promise } = await backgroundJob.execute(
				"delete-model",
				{
					serviceName: this.name,
					modelId,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "failed") {
				throw new Error(result.error || "Failed to delete model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	private emitProgressEvent(
		progress: ProgressEvent,
		stage: string,
		category?: ServeOptions["category"],
	): void {
		if (typeof window === "undefined") return;

		window.dispatchEvent(
			new CustomEvent(LLM_DOWNLOAD_PROGRESS_EVENT, {
				detail: {
					loaded: progress.loaded,
					total: progress.total,
					percent: progress.percent,
					text: stage,
					provider: this.llmType, // Include provider for debugging/logging if needed
					category,
				},
			}),
		);
	}

	async serve(
		modelId: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo> {
		try {
			const provider = this.llmType as ServiceProvider;
			if (onProgress) {
				// Use streaming job to capture progress for heavy operations like wllama
				const { stream } = await backgroundJob.createJob(
					"serve-model",
					{
						modelId,
						serviceName: this.name,
						provider,
						category: options?.category,
						select: options?.select,
					},
					{ stream: true },
				);

				let lastProgressEvent: JobProgressEvent | null = null;

				// Stream progress updates to onProgress callback and DOM events
				for await (const progressEvent of stream) {
					lastProgressEvent = progressEvent;
					if (progressEvent.progress !== undefined) {
						const percent = Math.min(100, Math.max(0, progressEvent.progress));
						const progressData = {
							loaded: percent,
							total: 100,
							percent: percent,
						};

						// Call callback if provided
						if (onProgress) {
							onProgress(progressData);
						}

						// Emit DOM event for cross-thread communication
						this.emitProgressEvent(
							progressData,
							progressEvent.stage || "Loading...",
							options?.category,
						);
					}

					if (progressEvent.status === "failed") {
						throw new Error(progressEvent.error || "Job failed");
					}

					if (progressEvent.status === "completed") {
						break;
					}
				}
				if (
					lastProgressEvent?.status === "completed" &&
					lastProgressEvent.result &&
					isModelInfoResult(lastProgressEvent.result)
				) {
					return lastProgressEvent.result.modelInfo as ModelInfo;
				}
				if (lastProgressEvent?.status === "failed") {
					throw new Error(lastProgressEvent.error || "Failed to serve model");
				}
			} else {
				// Get final result (or fallback if no progress callback)
				const { promise } = await backgroundJob.execute(
					"serve-model",
					{
						modelId,
						serviceName: this.name,
						provider,
						category: options?.category,
						select: options?.select,
					},
					{ stream: false },
				);

				const result = await promise;

				if (result.status === "completed" && result.result) {
					return result.result.modelInfo as ModelInfo;
				}
			}
			throw new Error("Failed to serve model");
		} catch (error) {
			this.emitProgressEvent(
				{ loaded: 0, total: 0, percent: 0 },
				error instanceof Error ? error.message : "Model load failed",
				options?.category,
			);
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async getToolCapabilities(model?: string): Promise<ToolCapabilityInfo> {
		// Transformer and wllama decide native tool support from the model's own
		// chat template at load time, and the background service reports it on
		// ModelInfo. Without this lookup the proxy answered "prompt injection"
		// for every local model, so any UI-context caller lost native tools.
		let supportsNativeTools = false;
		if (
			model &&
			(this.llmType === "transformer" || this.llmType === "wllama")
		) {
			try {
				const { data } = await this.models();
				supportsNativeTools =
					data.find(
						(candidate) => candidate.id.toLowerCase() === model.toLowerCase(),
					)?.supportsNativeTools === true;
			} catch {
				// Capability detection is best-effort; prompt injection always works.
			}
		}

		return resolveToolCapabilitiesForLLM(
			this.llmType,
			model,
			supportsNativeTools,
		);
	}

	async supportsTools(model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilities(model);
		return capability.supported;
	}

	getInfo(): LLMInfo {
		return {
			name: this.name,
			type: this.llmType as LLMType,
			ready: this.isReady(),
		};
	}

	// ---- Media endpoints, run where the models live ------------------------

	/**
	 * Run a media job and yield every event it streams, then its final result.
	 * Aborting the signal cancels the job in the offscreen document.
	 */
	private async *runMediaJob<Name extends keyof JobTypeRegistry>(
		jobName: Name,
		payload: JobTypeRegistry[Name],
		signal: AbortSignal | undefined,
	): AsyncIterableIterator<
		{ kind: "event"; event: unknown } | { kind: "result"; result: unknown }
	> {
		const { jobId, stream } = await backgroundJob.execute(jobName, payload, {
			stream: true,
		});
		const onAbort = () =>
			void backgroundJob
				.execute(
					"cancel-media-operation",
					{ targetJobId: jobId },
					{ stream: false },
				)
				.catch(() => undefined);
		if (signal?.aborted) onAbort();
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			for await (const progressEvent of stream) {
				const event = progressEvent.metadata?.[MEDIA_EVENT_METADATA_KEY];
				if (event) {
					yield { kind: "event", event };
				}
				if (progressEvent.status === "failed") {
					if (signal?.aborted) {
						throw new DOMException("Operation aborted", "AbortError");
					}
					throw new Error(progressEvent.error || "Media job failed");
				}
				if (progressEvent.status === "completed") {
					yield { kind: "result", result: progressEvent.result };
					return;
				}
			}
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	async audioSpeech(request: SpeechCreateParams): Promise<SpeechResponse> {
		for await (const event of this.audioSpeechStream(request)) {
			if (event.type === "speech.audio.done") return event.result;
		}
		throw new Error("Speech synthesis produced no audio");
	}

	async *audioSpeechStream(
		request: SpeechCreateParams,
	): AsyncIterableIterator<SpeechStreamEvent> {
		const { signal, ...wire } = request;
		for await (const item of this.runMediaJob(
			"audio-speech",
			{ serviceName: this.name, request: wire },
			signal,
		)) {
			if (item.kind === "event") {
				yield item.event as SpeechStreamEvent;
			} else {
				yield (item.result as { event: SpeechStreamEvent }).event;
			}
		}
	}

	async audioTranscriptions(
		request: TranscriptionCreateParams,
	): Promise<Transcription> {
		for await (const event of this.audioTranscriptionsStream(request)) {
			if (event.type === "transcript.text.done") return event.result;
		}
		throw new Error("Transcription produced no result");
	}

	async *audioTranscriptionsStream(
		request: TranscriptionCreateParams,
	): AsyncIterableIterator<TranscriptionStreamEvent> {
		const { signal, ...wire } = request;
		const input = await toWirePayload(wire.file);
		try {
			for await (const item of this.runMediaJob(
				"audio-transcription",
				{ serviceName: this.name, request: { ...wire, file: input.payload } },
				signal,
			)) {
				if (item.kind === "event") {
					yield item.event as TranscriptionStreamEvent;
				} else {
					yield {
						type: "transcript.text.done",
						result: (item.result as { transcription: Transcription })
							.transcription,
					};
				}
			}
		} finally {
			input.cleanup();
		}
	}

	async *imagesGenerations(
		request: ImageGenerateParams,
	): AsyncIterableIterator<ImageGenerationStreamEvent> {
		const { signal, ...wire } = request;
		for await (const item of this.runMediaJob(
			"image-generation",
			{ serviceName: this.name, request: wire },
			signal,
		)) {
			if (item.kind === "event") {
				yield item.event as ImageGenerationStreamEvent;
			} else {
				yield (item.result as { event: ImageGenerationStreamEvent }).event;
			}
		}
	}

	async imagesTools(request: ImageToolParams): Promise<ImageToolResponse> {
		const { signal, ...wire } = request;
		const input = await toWirePayload(wire.image);
		try {
			for await (const item of this.runMediaJob(
				"image-tool",
				{ serviceName: this.name, request: { ...wire, image: input.payload } },
				signal,
			)) {
				if (item.kind === "result") {
					return (item.result as { response: ImageToolResponse }).response;
				}
			}
			throw new Error("Image tool produced no result");
		} finally {
			input.cleanup();
		}
	}

	async textTools(request: TextToolParams): Promise<TextToolResponse> {
		const { signal, ...wire } = request;
		for await (const item of this.runMediaJob(
			"text-tool",
			{ serviceName: this.name, request: wire },
			signal,
		)) {
			if (item.kind === "result") {
				return (item.result as { response: TextToolResponse }).response;
			}
		}
		throw new Error("Text tool produced no result");
	}
}

function isModelInfoResult(
	value: ItemHandlerResult,
): value is { modelInfo: ModelInfo } {
	return (
		!!value &&
		!Array.isArray(value) &&
		typeof value === "object" &&
		"modelInfo" in value
	);
}
