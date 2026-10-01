import { serviceManager } from "@/services";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ImageToolTask,
	TextToolTask,
} from "@/services/llm/interfaces/model-category";
import { decisionStateOf } from "@/services/llm/utils/decision-schema";
import {
	persistGeneratedImage,
	persistMediaPayload,
	persistToolImage,
} from "@/services/llm/utils/media-persistence";
import type {
	DecisionQuestions,
	ImageGenerationStreamEvent,
	MediaPayload,
	SpeechStreamEvent,
	Transcription,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import type { StudioContentPart } from "@/types/studio";

/**
 * The studios' model calls, without their history. The Studio page records
 * each one as a session item around these; the agent's computer runs them
 * the same way and records the finished result.
 */
export interface StudioGenerationResult {
	parts: StudioContentPart[];
	/** Text the result is about, when it differs from the input. */
	content?: string;
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

export async function runSpeechGeneration(
	options: SpeechOptions,
): Promise<StudioGenerationResult> {
	let done: Extract<SpeechStreamEvent, { type: "speech.audio.done" }> | null =
		null;
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

export async function runTranscription(
	options: TranscriptionOptions,
	update?: (parts: StudioContentPart[], content: string) => void,
): Promise<StudioGenerationResult> {
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
			update?.([{ type: "text", text, role: "transcript" }], text);
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

export async function runImageGeneration(
	options: ImageGenerationOptions,
): Promise<StudioGenerationResult> {
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
}

export interface ImageToolOptions {
	model: CurrentModelInfo;
	task: ImageToolTask;
	image: Extract<MediaPayload, { kind: "file" }>;
	fileName?: string;
	threshold?: number;
	signal?: AbortSignal;
}

export async function runImageToolGeneration(
	options: ImageToolOptions,
): Promise<StudioGenerationResult> {
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

export async function runTextToolGeneration(
	options: TextToolOptions,
): Promise<StudioGenerationResult> {
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
}

export interface DecisionOptions {
	model: CurrentModelInfo;
	/** The text the questions are about, as typed. */
	input: string;
	questions: DecisionQuestions;
	signal?: AbortSignal;
}

/** Typed questions about a text, answered through `/systemone`. */
export async function runDecisionGeneration(
	options: DecisionOptions,
): Promise<StudioGenerationResult> {
	const response = await serviceManager.llmService.systemOneFor(
		options.model.serviceName,
		{
			model: options.model.modelId,
			state: decisionStateOf(options.input),
			questions: options.questions,
			signal: options.signal,
		},
	);
	return {
		parts: [
			{
				type: "decision",
				decision: {
					model: response.model,
					answers: response.answers,
					usage: response.usage,
				},
			},
		],
	};
}
