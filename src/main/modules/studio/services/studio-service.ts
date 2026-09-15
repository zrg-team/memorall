import { serviceManager } from "@/services";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ImageToolTask,
	TextToolTask,
	MediaCategory,
} from "@/services/llm/interfaces/model-category";
import { mimeTypeToExtension } from "@/services/llm/utils/media-encoding";
import {
	persistGeneratedImage,
	persistMediaPayload,
	persistToolImage,
} from "@/services/llm/utils/media-persistence";
import {
	markGenerationActive,
	type NewStudioItem,
	useStudioStore,
} from "@/main/stores/studio";
import type {
	ImageGenerationStreamEvent,
	MediaPayload,
	SpeechStreamEvent,
	Transcription,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type {
	StudioContentPart,
	StudioGenerationMetadata,
	StudioItem,
} from "@/types/studio";
import { isAbortError } from "@/utils/abort";

/** Save a user-provided file (recording, upload) and return its payload form. */
export async function saveStudioInput(
	file: Blob,
	kind: "audio" | "image",
): Promise<Extract<MediaPayload, { kind: "file" }>> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const mimeType = file.type || (kind === "audio" ? "audio/webm" : "image/png");
	const { documentFileSystemService } = await import(
		"@/services/filesystem/document-filesystem"
	);
	const path = await documentFileSystemService.saveMediaFile(bytes, {
		kind,
		extension:
			mimeTypeToExtension(mimeType) ||
			(file instanceof File && file.name.includes(".")
				? file.name.slice(file.name.lastIndexOf("."))
				: kind === "audio"
					? ".webm"
					: ".png"),
		folder: kind === "audio" ? "recordings" : "inputs",
	});
	return { kind: "file", path, mimeType };
}

interface GenerationContext {
	mode: MediaCategory;
	model: CurrentModelInfo;
	content: string;
	/** Parts known before the model runs (the prompt, the input clip). */
	inputParts: StudioContentPart[];
	params?: Record<string, unknown>;
	imageTask?: ImageToolTask;
	textTask?: TextToolTask;
}

/**
 * Record a generation as "running" immediately, then settle it.
 *
 * The placeholder is what makes a slow local model tolerable: the card shows
 * up the moment the user presses generate, with a live status, and survives a
 * reload as "failed" rather than vanishing if the tab dies mid-run.
 */
async function recordGeneration(
	context: GenerationContext,
	run: (
		update: (parts: StudioContentPart[], content?: string) => void,
	) => Promise<{ parts: StudioContentPart[]; content?: string }>,
): Promise<StudioItem> {
	const store = useStudioStore.getState();
	const startedAt = Date.now();
	const generation: StudioGenerationMetadata = {
		category: context.mode,
		provider: context.model.provider,
		serviceName: context.model.serviceName,
		modelId: context.model.modelId,
		status: "running",
		params: context.params,
		imageTask: context.imageTask,
		textTask: context.textTask,
	};
	const item = await store.addItem(context.mode, {
		content: context.content,
		parts: context.inputParts,
		generation,
	});
	markGenerationActive(item.id, true);

	const update = (parts: StudioContentPart[], content?: string) => {
		void useStudioStore.getState().updateItem(context.mode, item.id, {
			parts: [...context.inputParts, ...parts],
			...(content !== undefined ? { content } : {}),
		});
	};

	try {
		const result = await run(update);
		const settled: NewStudioItem = {
			content: result.content ?? context.content,
			parts: [...context.inputParts, ...result.parts],
			generation: {
				...generation,
				status: "done",
				durationMs: Date.now() - startedAt,
			},
		};
		markGenerationActive(item.id, false);
		await useStudioStore.getState().updateItem(context.mode, item.id, settled);
		return { ...item, ...settled };
	} catch (error) {
		markGenerationActive(item.id, false);
		const cancelled = isAbortError(error);
		await useStudioStore.getState().updateItem(context.mode, item.id, {
			generation: {
				...generation,
				status: cancelled ? "cancelled" : "failed",
				error: cancelled
					? undefined
					: error instanceof Error
						? error.message
						: String(error),
				durationMs: Date.now() - startedAt,
			},
		});
		throw error;
	}
}

export interface SpeechOptions {
	mode?: "text-to-speech" | "text-to-audio";
	model: CurrentModelInfo;
	input: string;
	voice: string;
	speed?: number;
	instructions?: string;
	seed?: number;
	/** Seconds of audio, for models that generate it (music). */
	duration?: number;
	signal?: AbortSignal;
	/** Every streamed chunk, for live playback. */
	onDelta?: (
		event: Extract<SpeechStreamEvent, { type: "speech.audio.delta" }>,
	) => void;
}

export function generateSpeech(options: SpeechOptions): Promise<StudioItem> {
	const mode = options.mode ?? "text-to-speech";
	return recordGeneration(
		{
			mode,
			model: options.model,
			content: options.input,
			inputParts: [{ type: "text", text: options.input, role: "prompt" }],
			params: {
				voice: options.voice,
				speed: options.speed,
				instructions: options.instructions,
				seed: options.seed,
				duration: options.duration,
			},
		},
		async () => {
			let done: Extract<
				SpeechStreamEvent,
				{ type: "speech.audio.done" }
			> | null = null;
			for await (const event of serviceManager.llmService.audioSpeechStreamFor(
				options.model.serviceName,
				{
					model: options.model.modelId,
					input: options.input,
					voice: options.voice,
					speed: options.speed,
					instructions: options.instructions,
					seed: options.seed,
					duration: options.duration,
					signal: options.signal,
				},
			)) {
				if (event.type === "speech.audio.delta") {
					options.onDelta?.(event);
				} else {
					done = event;
				}
			}
			if (!done) throw new Error("Speech synthesis produced no audio");
			const stored = await persistMediaPayload(done.result.audio, {
				kind: "audio",
				folder: "generated",
			});
			return {
				parts: [
					{
						type: "output_audio",
						output_audio: {
							path: stored.path,
							mimeType: stored.mimeType,
							sampleRate: done.result.sample_rate,
							durationMs: done.result.duration_ms,
							voice: options.voice,
						},
					},
				],
			};
		},
	);
}

export interface TranscriptionOptions {
	model: CurrentModelInfo;
	file: Extract<MediaPayload, { kind: "file" }>;
	fileName?: string;
	durationMs?: number;
	language?: string;
	task?: "transcribe" | "translate";
	signal?: AbortSignal;
	onDelta?: (textSoFar: string) => void;
}

export function transcribeAudio(
	options: TranscriptionOptions,
): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "speech-to-text",
			model: options.model,
			content: options.fileName ?? "Recording",
			inputParts: [
				{
					type: "input_audio",
					input_audio: {
						path: options.file.path,
						mimeType: options.file.mimeType,
						durationMs: options.durationMs,
						name: options.fileName,
					},
				},
			],
			params: { language: options.language, task: options.task },
		},
		async (update) => {
			let text = "";
			let result: Transcription | null = null;
			for await (const event of serviceManager.llmService.audioTranscriptionsStreamFor(
				options.model.serviceName,
				{
					model: options.model.modelId,
					file: options.file,
					language: options.language,
					task: options.task,
					timestamp_granularities: ["segment"],
					signal: options.signal,
				},
			) as AsyncIterableIterator<TranscriptionStreamEvent>) {
				if (event.type === "transcript.text.delta") {
					text += event.delta;
					options.onDelta?.(text);
					update([{ type: "text", text, role: "transcript" }], text);
				} else {
					result = event.result;
				}
			}
			if (!result) throw new Error("Transcription produced no result");
			const parts: StudioContentPart[] = [
				{ type: "text", text: result.text, role: "transcript" },
			];
			if (result.segments?.length) {
				parts.push({
					type: "segments",
					segments: result.segments,
					language: result.language,
				});
			}
			return { parts, content: result.text || options.fileName };
		},
	);
}

export interface ImageGenerationOptions {
	model: CurrentModelInfo;
	prompt: string;
	size?: string;
	n?: number;
	seed?: number;
	quality?: "auto" | "low" | "medium" | "high";
	/** Images to work from; the first is the one to change. */
	references?: Extract<MediaPayload, { kind: "file" }>[];
	mask?: Extract<MediaPayload, { kind: "file" }>;
	/** Stored with the prompt: what the images to work from are. */
	inputParts?: StudioContentPart[];
	signal?: AbortSignal;
	onProgress?: (percent: number) => void;
}

export function generateImages(
	options: ImageGenerationOptions,
): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "image-generation",
			model: options.model,
			content: options.prompt,
			inputParts: [
				{ type: "text", text: options.prompt, role: "prompt" },
				...(options.inputParts ?? []),
			],
			params: {
				size: options.size,
				n: options.n,
				seed: options.seed,
				quality: options.quality,
			},
		},
		async () => {
			let completed: Extract<
				ImageGenerationStreamEvent,
				{ type: "image_generation.completed" }
			> | null = null;
			for await (const event of serviceManager.llmService.imagesGenerationsFor(
				options.model.serviceName,
				{
					model: options.model.modelId,
					prompt: options.prompt,
					size: options.size,
					n: options.n,
					seed: options.seed,
					quality: options.quality,
					image: options.references?.length ? options.references : undefined,
					mask: options.mask,
					signal: options.signal,
				},
			)) {
				if (event.type === "image_generation.progress") {
					options.onProgress?.(event.percent);
				} else if (event.type === "image_generation.completed") {
					completed = event;
				}
			}
			if (!completed) throw new Error("Image generation produced no image");
			const stored = await Promise.all(
				completed.result.data.map((image) => persistGeneratedImage(image)),
			);
			if (!stored.some((image) => image.path)) {
				throw new Error("The model returned no image that could be saved");
			}
			return {
				parts: stored
					.filter((image) => image.path)
					.map((image) => ({
						type: "image" as const,
						image: {
							path: image.path as string,
							mimeType: image.mime_type ?? "image/png",
							role: "generated" as const,
						},
					})),
			};
		},
	);
}

export interface ImageToolOptions {
	model: CurrentModelInfo;
	task: ImageToolTask;
	image: Extract<MediaPayload, { kind: "file" }>;
	fileName?: string;
	threshold?: number;
	signal?: AbortSignal;
}

export function runImageTool(options: ImageToolOptions): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "image-tools",
			model: options.model,
			content: options.fileName ?? options.task,
			imageTask: options.task,
			inputParts: [
				{
					type: "image",
					image: {
						path: options.image.path,
						mimeType: options.image.mimeType,
						role: "input",
					},
				},
			],
			params: { task: options.task, threshold: options.threshold },
		},
		async () => {
			const response = await serviceManager.llmService.imagesToolsFor(
				options.model.serviceName,
				{
					model: options.model.modelId,
					task: options.task,
					image: options.image,
					options: { threshold: options.threshold },
					signal: options.signal,
				},
			);
			const images = await Promise.all(
				(response.images ?? []).map((image) => persistToolImage(image)),
			);
			const parts: StudioContentPart[] = images
				.filter((image) => image.path)
				.map((image) => ({
					type: "image",
					image: {
						path: image.path as string,
						mimeType: image.mime_type,
						role: image.role,
						label: image.label,
						width: image.width,
						height: image.height,
					},
				}));
			if (response.detections?.length) {
				parts.push({ type: "detections", detections: response.detections });
			}
			if (response.labels?.length) {
				parts.push({ type: "labels", labels: response.labels });
			}
			if (response.text) {
				parts.push({ type: "text", text: response.text, role: "caption" });
			}
			return { parts, content: response.text || options.fileName };
		},
	);
}

export interface TextToolOptions {
	model: CurrentModelInfo;
	task: TextToolTask;
	/** The text to classify, or the query to rank documents against. */
	input: string;
	/** Zero-shot: candidate labels. */
	labels?: string[];
	multiLabel?: boolean;
	hypothesisTemplate?: string;
	/** Ranking: documents to order. */
	documents?: string[];
	signal?: AbortSignal;
}

export function runTextTool(options: TextToolOptions): Promise<StudioItem> {
	const params = {
		task: options.task,
		labels: options.labels,
		multiLabel: options.multiLabel,
		hypothesisTemplate: options.hypothesisTemplate,
		documents: options.documents,
	};
	return recordGeneration(
		{
			mode: "text-tools",
			model: options.model,
			content: options.input,
			textTask: options.task,
			inputParts: [{ type: "text", text: options.input, role: "prompt" }],
			params,
		},
		async () => {
			const response = await serviceManager.llmService.textToolsFor(
				options.model.serviceName,
				{
					model: options.model.modelId,
					task: options.task,
					input: options.input,
					options: {
						labels: options.labels,
						multiLabel: options.multiLabel,
						hypothesisTemplate: options.hypothesisTemplate,
						documents: options.documents,
					},
					signal: options.signal,
				},
			);
			const parts: StudioContentPart[] = [];
			if (response.labels?.length) {
				parts.push({ type: "labels", labels: response.labels });
			}
			if (response.ranking?.length) {
				parts.push({ type: "ranking", ranking: response.ranking });
			}
			return { parts };
		},
	);
}

export const isCancellation = isAbortError;
