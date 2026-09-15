import { serviceManager } from "@/services";
import {
	persistGeneratedImage,
	persistMediaPayload,
	persistToolImage,
} from "@/services/llm/utils/media-persistence";
import type {
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImageToolParams,
	ImageToolResponse,
	TextToolParams,
	TextToolResponse,
	SpeechCreateParams,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import { backgroundProcessFactory } from "./process-factory";
import type {
	BaseJob,
	ItemHandlerResult,
	ProcessDependencies,
	ProcessHandler,
} from "./types";

export const MEDIA_JOB_NAMES = {
	audioSpeech: "audio-speech",
	audioTranscription: "audio-transcription",
	imageGeneration: "image-generation",
	imageTool: "image-tool",
	textTool: "text-tool",
	cancelMediaOperation: "cancel-media-operation",
} as const;

type WireRequest<T> = Omit<T, "signal">;

export interface AudioSpeechPayload {
	serviceName: string;
	request: WireRequest<SpeechCreateParams>;
}

export interface AudioTranscriptionPayload {
	serviceName: string;
	/** `file` must be a file path or base64 - the job channel is JSON only. */
	request: WireRequest<TranscriptionCreateParams>;
}

export interface ImageGenerationPayload {
	serviceName: string;
	request: WireRequest<ImageGenerateParams>;
}

export interface ImageToolPayload {
	serviceName: string;
	request: WireRequest<ImageToolParams>;
}

export interface TextToolPayload {
	serviceName: string;
	request: WireRequest<TextToolParams>;
}

export interface CancelMediaOperationPayload {
	targetJobId: string;
}

/** Progress metadata key carrying one streamed media event. */
export const MEDIA_EVENT_METADATA_KEY = "mediaEvent";

export interface AudioSpeechResult extends Record<string, unknown> {
	/** The `speech.audio.done` event, audio stored as a file. */
	event: SpeechStreamEvent;
}

export interface AudioTranscriptionResult extends Record<string, unknown> {
	transcription: Transcription;
}

export interface ImageGenerationResult extends Record<string, unknown> {
	event: ImageGenerationStreamEvent;
}

export interface ImageToolResult extends Record<string, unknown> {
	response: ImageToolResponse;
}

export interface TextToolResult extends Record<string, unknown> {
	response: TextToolResponse;
}

/**
 * Runs media endpoints where the models live (the offscreen document in the
 * extension) and streams their events back through job progress.
 *
 * Final audio and images are written to the documents filesystem here and
 * returned as paths: a speech clip is megabytes, and job results are persisted
 * to IndexedDB, so inlining it would store every clip twice.
 */
const CANCEL_MEMORY_MS = 60_000;

export class MediaOperationsHandler implements ProcessHandler<BaseJob> {
	private readonly abortControllers = new Map<string, AbortController>();
	private readonly cancelledBeforeStart = new Set<string>();

	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		if (job.jobType === MEDIA_JOB_NAMES.cancelMediaOperation) {
			const { targetJobId } = job.payload as CancelMediaOperationPayload;
			const running = this.abortControllers.get(targetJobId);
			if (running) {
				running.abort();
			} else {
				// Not started yet (or already finished): remember briefly so a job
				// that starts right after still sees the cancel.
				this.cancelledBeforeStart.add(targetJobId);
				setTimeout(
					() => this.cancelledBeforeStart.delete(targetJobId),
					CANCEL_MEMORY_MS,
				);
			}
			return { canceled: true };
		}

		const controller = new AbortController();
		this.abortControllers.set(jobId, controller);
		if (this.cancelledBeforeStart.delete(jobId)) {
			controller.abort();
		}

		try {
			switch (job.jobType) {
				case MEDIA_JOB_NAMES.audioSpeech:
					return await this.speech(jobId, job, dependencies, controller.signal);
				case MEDIA_JOB_NAMES.audioTranscription:
					return await this.transcription(
						jobId,
						job,
						dependencies,
						controller.signal,
					);
				case MEDIA_JOB_NAMES.imageGeneration:
					return await this.imageGeneration(
						jobId,
						job,
						dependencies,
						controller.signal,
					);
				case MEDIA_JOB_NAMES.imageTool:
					return await this.imageTool(
						jobId,
						job,
						dependencies,
						controller.signal,
					);
				case MEDIA_JOB_NAMES.textTool:
					return await this.textTool(job, controller.signal);
				default:
					throw new Error(`Unknown media job type: ${job.jobType}`);
			}
		} finally {
			this.abortControllers.delete(jobId);
		}
	}

	private get llm() {
		const service = serviceManager.getLLMService();
		if (!service) throw new Error("LLM service not available");
		return service;
	}

	private async emit(
		jobId: string,
		dependencies: ProcessDependencies,
		event: unknown,
		progress: number,
		stage: string,
	): Promise<void> {
		await dependencies.updateJobProgress(jobId, {
			stage,
			progress,
			metadata: { [MEDIA_EVENT_METADATA_KEY]: event },
		});
	}

	private async speech(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
		signal: AbortSignal,
	): Promise<ItemHandlerResult> {
		const { serviceName, request } = job.payload as AudioSpeechPayload;
		let done: SpeechStreamEvent | null = null;

		for await (const event of this.llm.audioSpeechStreamFor(serviceName, {
			...request,
			signal,
		})) {
			if (signal.aborted)
				throw new DOMException("Operation aborted", "AbortError");
			if (event.type === "speech.audio.delta") {
				await this.emit(jobId, dependencies, event, 50, "Synthesizing speech");
				continue;
			}
			done = {
				type: "speech.audio.done",
				result: {
					...event.result,
					audio: await persistMediaPayload(event.result.audio, {
						kind: "audio",
						folder: "generated",
					}),
				},
			};
		}

		if (!done) throw new Error("Speech synthesis produced no audio");
		return { event: done } satisfies AudioSpeechResult;
	}

	private async transcription(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
		signal: AbortSignal,
	): Promise<ItemHandlerResult> {
		const { serviceName, request } = job.payload as AudioTranscriptionPayload;
		let result: Transcription | null = null;

		for await (const event of this.llm.audioTranscriptionsStreamFor(
			serviceName,
			{ ...request, signal },
		) as AsyncIterableIterator<TranscriptionStreamEvent>) {
			if (event.type === "transcript.text.delta") {
				await this.emit(jobId, dependencies, event, 50, "Transcribing");
			} else {
				result = event.result;
			}
		}

		if (!result) throw new Error("Transcription produced no result");
		return { transcription: result } satisfies AudioTranscriptionResult;
	}

	private async imageGeneration(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
		signal: AbortSignal,
	): Promise<ItemHandlerResult> {
		const { serviceName, request } = job.payload as ImageGenerationPayload;
		let completed: ImageGenerationStreamEvent | null = null;

		for await (const event of this.llm.imagesGenerationsFor(serviceName, {
			...request,
			signal,
		})) {
			if (event.type === "image_generation.completed") {
				completed = {
					type: "image_generation.completed",
					result: {
						...event.result,
						data: await Promise.all(
							event.result.data.map((image) => persistGeneratedImage(image)),
						),
					},
				};
				continue;
			}
			const progress =
				event.type === "image_generation.progress" ? event.percent : 50;
			await this.emit(jobId, dependencies, event, progress, "Generating image");
		}

		if (!completed) throw new Error("Image generation produced no image");
		return { event: completed } satisfies ImageGenerationResult;
	}

	private async imageTool(
		_jobId: string,
		job: BaseJob,
		_dependencies: ProcessDependencies,
		signal: AbortSignal,
	): Promise<ItemHandlerResult> {
		const { serviceName, request } = job.payload as ImageToolPayload;
		const response = await this.llm.imagesToolsFor(serviceName, {
			...request,
			signal,
		});
		return {
			response: {
				...response,
				images: response.images
					? await Promise.all(response.images.map(persistToolImage))
					: undefined,
			},
		} satisfies ImageToolResult;
	}

	private async textTool(
		job: BaseJob,
		signal: AbortSignal,
	): Promise<ItemHandlerResult> {
		const { serviceName, request } = job.payload as TextToolPayload;
		const response = await this.llm.textToolsFor(serviceName, {
			...request,
			signal,
		});
		return { response } satisfies TextToolResult;
	}
}

backgroundProcessFactory.register({
	instance: new MediaOperationsHandler(),
	jobs: Object.values(MEDIA_JOB_NAMES),
});

declare global {
	interface JobTypeRegistry {
		"audio-speech": AudioSpeechPayload;
		"audio-transcription": AudioTranscriptionPayload;
		"image-generation": ImageGenerationPayload;
		"image-tool": ImageToolPayload;
		"text-tool": TextToolPayload;
		"cancel-media-operation": CancelMediaOperationPayload;
	}

	interface JobResultRegistry {
		"audio-speech": AudioSpeechResult;
		"audio-transcription": AudioTranscriptionResult;
		"image-generation": ImageGenerationResult;
		"image-tool": ImageToolResult;
		"text-tool": TextToolResult;
		"cancel-media-operation": { canceled: boolean };
	}
}
