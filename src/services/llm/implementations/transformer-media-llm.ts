import { LLM_RUNNER_URLS } from "@/config/llm-runner";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type {
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type {
	BaseLLM,
	LLMInfo,
	ModelInfo,
	ModelsResponse,
	ProgressEvent,
} from "../interfaces/base-llm";
import type { MediaModelConfig } from "../interfaces/media-model-config";
import {
	NO_TOOL_SUPPORT,
	type ToolCapabilityInfo,
} from "../interfaces/tool-capability";
import {
	imageToolTaskOf,
	textToolTaskOf,
} from "../registry/media-model-registry";
import {
	getMediaModel,
	inspectHubModel,
	listMediaModels,
	saveMediaModel,
} from "../registry/media-model-store";
import { AsyncEventQueue } from "../utils/async-event-queue";
import {
	PcmChunkBatcher,
	bytesToBase64,
	concatFloat32,
	encodeWav,
	float32ToPcm16,
} from "../utils/media-encoding";
import { mediaPayloadToBytes } from "../utils/media-payload";
import { IframeRuntime } from "./iframe-runtime";
import { RunnerIframeClient } from "./runner-iframe-client";

/** One model as the runner reports it. */
interface RunnerModelStatus {
	id: string;
	loaded?: boolean;
	downloaded?: boolean;
	device?: string;
	dtype?: string;
}

interface RunnerImageOutput {
	bytes: Uint8Array;
	mimeType: string;
	role?: "mask" | "cutout" | "depth";
	label?: string;
	width?: number;
	height?: number;
}

interface RunnerImageToolResult {
	images?: RunnerImageOutput[];
	text?: string;
	detections?: ImageToolResponse["detections"];
	labels?: ImageToolResponse["labels"];
}

/** Sample rate assumed only until the runner reports the model's own. */
const FALLBACK_SAMPLE_RATE = 16_000;

const withoutSignal = <T extends { signal?: AbortSignal }>(
	request: T,
): Omit<T, "signal"> => {
	const { signal: _signal, ...rest } = request;
	return rest;
};

/**
 * On-device media models through transformers.js pipelines.
 *
 * Model-agnostic: any Hub repo transformers.js can run for a studio task is
 * served the same way. The first serve of an unknown repo inspects it on the
 * Hub and stores the result, so a picker, a search result or an API caller can
 * all simply ask for a repo id. Requests carry the stored config to the runner,
 * which calls `pipeline(task, repo)` and lets the library pick the
 * architecture, tokenizer and processor.
 *
 * Runs in its own runner iframe (`?mode=media`) so its cache and lifecycle
 * never collide with the chat transformer runner. Chat is refused.
 */
export class TransformerMediaLLM implements BaseLLM {
	readonly name = "transformer-media" as const;

	private client: RunnerIframeClient | null = null;
	private runtime: IframeRuntime | null = null;

	private getClient(): RunnerIframeClient {
		if (!this.client) {
			// No global download event: that one drives the app-wide chat model
			// screen, and studios report load progress through `onProgress`.
			this.client = new RunnerIframeClient(LLM_RUNNER_URLS.media, this.name);
		}
		return this.client;
	}

	private getRuntime(): IframeRuntime {
		if (!this.runtime) {
			this.runtime = new IframeRuntime({
				provider: this.name,
				ensureReady: () => this.initialize(),
				isReady: () => this.isReady(),
				destroyIframe: () => this.destroy(),
				fetchModels: () => this.fetchRunnerModels(),
			});
		}
		return this.runtime;
	}

	async initialize(): Promise<void> {
		await this.getClient().initialize();
	}

	isReady(): boolean {
		return this.client?.isReady() ?? false;
	}

	async getMaxModelTokens(): Promise<number> {
		return 0;
	}

	async getMaxResponseTokens(): Promise<number> {
		return 0;
	}

	/** The stored config for `modelId`, inspecting the Hub the first time. */
	private async resolveConfig(modelId: string): Promise<MediaModelConfig> {
		const stored = await getMediaModel(modelId);
		if (stored) return stored;
		const inspected = await inspectHubModel(modelId);
		await saveMediaModel(inspected);
		return inspected;
	}

	private toModelInfo(
		config: MediaModelConfig,
		status?: RunnerModelStatus,
	): ModelInfo {
		return {
			id: config.id,
			name: config.displayName,
			object: "model",
			created: Math.floor(new Date(config.addedAt).getTime() / 1000) || 0,
			owned_by: this.name,
			provider: this.name,
			loaded: status?.loaded === true,
			downloaded: status?.downloaded === true || status?.loaded === true,
			size: config.sizeBytes,
			sizeByDevice: config.sizeByDevice,
			device: status?.device,
			dtype: status?.dtype,
			categories: [config.category],
			voices: config.voices,
			languages: config.languages,
			imageTask: imageToolTaskOf(config),
			textTask: textToolTaskOf(config),
		};
	}

	private async fetchRunnerModels(): Promise<ModelsResponse> {
		const catalog = await listMediaModels();
		const response = (await this.getClient().request("models", {
			catalog,
		})) as { data?: RunnerModelStatus[] } | undefined;
		const statuses = new Map(
			(response?.data ?? []).map((status) => [status.id.toLowerCase(), status]),
		);
		return {
			object: "list",
			data: catalog.map((config) =>
				this.toModelInfo(config, statuses.get(config.id.toLowerCase())),
			),
		};
	}

	async models(): Promise<ModelsResponse> {
		const runtime = this.getRuntime();
		const cached = await runtime.cachedModelsWhenNotCurrent();
		if (!cached) {
			return runtime.run(() => runtime.refreshModels());
		}
		// The catalog is shared storage that any context can change (a model
		// added from the UI, say), so it is always read fresh; only the runner's
		// loaded/downloaded state comes from the cache.
		const catalog = await listMediaModels();
		const statuses = new Map(
			cached.data.map((model) => [model.id.toLowerCase(), model]),
		);
		return {
			object: "list",
			data: catalog.map((config) => {
				const status = statuses.get(config.id.toLowerCase());
				return this.toModelInfo(
					config,
					status
						? {
								id: status.id,
								loaded: status.loaded,
								downloaded: status.downloaded,
								device: status.device,
								dtype: status.dtype,
							}
						: undefined,
				);
			}),
		};
	}

	chatCompletions(
		request: ChatCompletionRequest & { stream?: false },
	): Promise<ChatCompletionResponse>;
	chatCompletions(
		request: ChatCompletionRequest & { stream: true },
	): AsyncIterableIterator<ChatCompletionChunk>;
	chatCompletions(
		_request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		throw new Error(`${this.name} does not serve chat models`);
	}

	async serve(
		modelId: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		const config = await this.resolveConfig(modelId);
		const runtime = this.getRuntime();
		return runtime.run(
			async () => {
				const status = (await this.getClient().request(
					"serve",
					{ model: config.id, config },
					{ onProgress },
				)) as RunnerModelStatus | undefined;
				const info = this.toModelInfo(config, {
					id: config.id,
					...status,
					loaded: true,
					downloaded: true,
				});
				return runtime.upsertCachedModel(info);
			},
			{ keepAlive: true },
		);
	}

	async unload(modelId: string): Promise<void> {
		if (!this.isReady()) return;
		const runtime = this.getRuntime();
		await runtime.run(async () => {
			await this.getClient().request("unload", { model: modelId });
			await runtime.refreshModelsAfterMutation();
		});
	}

	async delete(modelId: string): Promise<void> {
		const config = await getMediaModel(modelId);
		const runtime = this.getRuntime();
		await runtime.run(async () => {
			await this.getClient().request("delete", {
				model: config?.id ?? modelId,
				config,
			});
			await runtime.refreshModelsAfterMutation();
		});
	}

	destroy(): void {
		this.runtime?.cancelIdleDestroy();
		// The cached model list describes the runner being torn down.
		this.runtime = null;
		this.client?.destroy();
		this.client = null;
	}

	getInfo(): LLMInfo {
		return { name: this.name, type: this.name, ready: this.isReady() };
	}

	async getToolCapabilities(): Promise<ToolCapabilityInfo> {
		return NO_TOOL_SUPPORT;
	}

	async supportsTools(): Promise<boolean> {
		return false;
	}

	// ---- POST /v1/audio/speech --------------------------------------------

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
		let sampleRate = FALLBACK_SAMPLE_RATE;
		const batcherRef: { current: PcmChunkBatcher | null } = { current: null };
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
			const config = await this.resolveConfig(request.model);
			const runtime = this.getRuntime();
			const final = await runtime.run(() =>
				this.getClient().request(
					"audio/speech",
					{ ...withoutSignal(request), config },
					{
						signal: request.signal,
						onChunk: (chunk) => {
							const { pcm, sampleRate: rate } = chunk as {
								pcm?: Float32Array;
								sampleRate?: number;
							};
							if (!(pcm instanceof Float32Array)) return;
							if (rate) sampleRate = rate;
							batcherRef.current ??= new PcmChunkBatcher(sampleRate);
							frames.push(pcm);
							emit(batcherRef.current.push(pcm));
						},
					},
				),
			);
			const finalRate = (final as { sampleRate?: number } | undefined)
				?.sampleRate;
			if (finalRate) sampleRate = finalRate;
			emit(batcherRef.current?.flush() ?? null);
			const samples = concatFloat32(frames);
			queue.push({
				type: "speech.audio.done",
				result: {
					object: "audio.speech",
					model: config.id,
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

	// ---- POST /v1/audio/transcriptions ------------------------------------

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
			const config = await this.resolveConfig(request.model);
			const bytes = await mediaPayloadToBytes(request.file);
			// Copy so the transfer never detaches a buffer the caller still owns.
			const audio = bytes.slice().buffer;
			const { file: _file, ...rest } = withoutSignal(request);
			const result = (await this.getRuntime().run(() =>
				this.getClient().request(
					"audio/transcriptions",
					{ ...rest, config, audio, mimeType: request.file.mimeType },
					{
						signal: request.signal,
						transfer: [audio],
						onChunk: (chunk) => {
							const delta = (chunk as { delta?: string })?.delta;
							if (delta) queue.push({ type: "transcript.text.delta", delta });
						},
					},
				),
			)) as Transcription;
			queue.push({ type: "transcript.text.done", result });
			queue.end();
		})().catch((error) => queue.fail(error));

		return queue;
	}

	// ---- POST /v1/images/tools (Memorall extension) -----------------------

	async imagesTools(request: ImageToolParams): Promise<ImageToolResponse> {
		const config = await this.resolveConfig(request.model);
		const task = imageToolTaskOf(config);
		if (task !== request.task) {
			throw new Error(
				`${config.id} is a ${config.task} model and cannot run ${request.task}`,
			);
		}
		const bytes = await mediaPayloadToBytes(request.image);
		const image = bytes.slice().buffer;
		const { image: _image, ...rest } = withoutSignal(request);
		const result = (await this.getRuntime().run(() =>
			this.getClient().request(
				"images/tools",
				{ ...rest, config, image, mimeType: request.image.mimeType },
				{ signal: request.signal, transfer: [image] },
			),
		)) as RunnerImageToolResult;

		return {
			object: "image.tool",
			task,
			model: config.id,
			text: result.text,
			detections: result.detections,
			labels: result.labels,
			images: result.images?.map((output) => ({
				b64_json: bytesToBase64(output.bytes),
				mime_type: output.mimeType,
				role: output.role ?? "mask",
				label: output.label,
				width: output.width,
				height: output.height,
			})),
		};
	}

	// ---- POST /v1/text/tools (Memorall extension) -------------------------

	async textTools(request: TextToolParams): Promise<TextToolResponse> {
		const config = await this.resolveConfig(request.model);
		const task = textToolTaskOf(config);
		if (task !== request.task) {
			throw new Error(
				`${config.id} is a ${config.task} model and cannot run ${request.task}`,
			);
		}
		const result = (await this.getRuntime().run(() =>
			this.getClient().request(
				"text/tools",
				{ ...withoutSignal(request), config },
				{ signal: request.signal },
			),
		)) as Pick<TextToolResponse, "labels" | "ranking">;
		return {
			object: "text.tool",
			task,
			model: config.id,
			labels: result.labels,
			ranking: result.ranking,
		};
	}
}
