// OpenAI-compatible media request/response shapes.
//
// These mirror `/v1/audio/speech`, `/v1/audio/transcriptions` and
// `/v1/images/generations`, plus one Memorall extension (`/v1/images/tools`)
// for single-shot image tasks that OpenAI has no endpoint for. Every shape is
// JSON-safe except `MediaPayload.bytes`: requests cross runtime messaging in
// the extension, which drops ArrayBuffers, so binary data travels
// as a documents-filesystem path or base64 whenever it leaves its context.

import type {
	ImageToolTask,
	TextToolTask,
} from "@/services/llm/interfaces/model-category";

export type { ImageToolTask, TextToolTask };

export type MediaPayload =
	| { kind: "base64"; data: string; mimeType: string }
	/** Logical path inside the documents filesystem (see `uploadChatMedia`). */
	| { kind: "file"; path: string; mimeType: string }
	/** Same-context only; never put this on a background-job payload. */
	| { kind: "bytes"; bytes: Uint8Array; mimeType: string };

export interface MediaVoice {
	id: string;
	name: string;
	language?: string;
	gender?: "female" | "male" | "neutral";
	/** URL of a short preview clip, when the model ships one. */
	previewUrl?: string;
	/** Speaker-embedding file the voice is loaded from, for local models. */
	path?: string;
}

// ---------------------------------------------------------------------------
// POST /v1/audio/speech
// ---------------------------------------------------------------------------

export type SpeechResponseFormat =
	| "mp3"
	| "opus"
	| "aac"
	| "flac"
	| "wav"
	| "pcm";

export interface SpeechCreateParams {
	model: string;
	input: string;
	voice: string;
	/** Optional style prompt; models that do not take one ignore it. */
	instructions?: string;
	response_format?: SpeechResponseFormat;
	/** 0.25 - 4.0, 1 is natural speed. */
	speed?: number;
	language?: string;
	/** Deterministic sampling, for models that sample. */
	seed?: number;
	/**
	 * Seconds of audio to make, for local models that generate audio token by
	 * token (music, effects). Speech length follows the text instead.
	 */
	duration?: number;
	signal?: AbortSignal;
}

export interface SpeechResponse {
	object: "audio.speech";
	model: string;
	voice: string;
	audio: MediaPayload;
	sample_rate: number;
	duration_ms: number;
	usage?: { input_characters: number };
}

/** Mirrors the OpenAI `stream_format: "sse"` event names. */
export type SpeechStreamEvent =
	| {
			type: "speech.audio.delta";
			/** Base64 little-endian signed 16-bit mono PCM. */
			audio: string;
			sample_rate: number;
			seq: number;
	  }
	| { type: "speech.audio.done"; result: SpeechResponse };

// ---------------------------------------------------------------------------
// POST /v1/audio/transcriptions
// ---------------------------------------------------------------------------

export type TranscriptionResponseFormat =
	| "json"
	| "text"
	| "verbose_json"
	| "srt"
	| "vtt";

export interface TranscriptionCreateParams {
	model: string;
	file: MediaPayload;
	/** ISO-639-1; omit to auto-detect. */
	language?: string;
	prompt?: string;
	response_format?: TranscriptionResponseFormat;
	temperature?: number;
	timestamp_granularities?: ("word" | "segment")[];
	/** Translate to English instead of transcribing. */
	task?: "transcribe" | "translate";
	signal?: AbortSignal;
}

export interface TranscriptionSegment {
	id: number;
	/** Seconds. */
	start: number;
	end: number;
	text: string;
}

export interface TranscriptionWord {
	word: string;
	start: number;
	end: number;
}

export interface Transcription {
	text: string;
	language?: string;
	/** Seconds. */
	duration?: number;
	segments?: TranscriptionSegment[];
	words?: TranscriptionWord[];
}

export type TranscriptionStreamEvent =
	| { type: "transcript.text.delta"; delta: string }
	| { type: "transcript.text.done"; result: Transcription };

// ---------------------------------------------------------------------------
// POST /v1/images/generations
// ---------------------------------------------------------------------------

export interface ImageGenerateParams {
	model: string;
	prompt: string;
	n?: number;
	/** "1024x1024", "auto", ... */
	size?: string;
	quality?: "auto" | "low" | "medium" | "high" | "standard" | "hd";
	response_format?: "b64_json" | "url";
	output_format?: "png" | "jpeg" | "webp";
	/**
	 * Images to work from. With any, the request is an edit: OpenAI's
	 * `/v1/images/edits`, or image parts of the message for chat image models.
	 */
	image?: MediaPayload[];
	/** Transparent where the first image may change (`/v1/images/edits`). */
	mask?: MediaPayload;
	/** Local-model extensions. */
	seed?: number;
	negative_prompt?: string;
	guidance_scale?: number;
	signal?: AbortSignal;
}

export interface GeneratedImageData {
	b64_json?: string;
	url?: string;
	/** Documents-filesystem path once persisted. */
	path?: string;
	mime_type?: string;
	revised_prompt?: string;
}

export interface ImagesResponse {
	created: number;
	data: GeneratedImageData[];
	usage?: { input_tokens?: number; output_tokens?: number };
}

export type ImageGenerationStreamEvent =
	| {
			type: "image_generation.progress";
			/** 0 - 100. */
			percent: number;
			step?: number;
			total_steps?: number;
	  }
	| {
			type: "image_generation.partial_image";
			b64_json: string;
			partial_image_index: number;
	  }
	| { type: "image_generation.completed"; result: ImagesResponse };

// ---------------------------------------------------------------------------
// POST /v1/images/tools (Memorall extension)
// ---------------------------------------------------------------------------

export interface ImageToolParams {
	model: string;
	task: ImageToolTask;
	image: MediaPayload;
	options?: {
		/** Detection score cut-off, 0 - 1. */
		threshold?: number;
		prompt?: string;
	};
	signal?: AbortSignal;
}

export interface ImageToolBox {
	xmin: number;
	ymin: number;
	xmax: number;
	ymax: number;
}

export interface ImageToolDetection {
	label: string;
	score: number;
	box: ImageToolBox;
}

export interface ImageToolImage {
	b64_json?: string;
	path?: string;
	mime_type: string;
	role: "mask" | "cutout" | "depth";
	/** Segment label, for segmentation masks. */
	label?: string;
	width?: number;
	height?: number;
}

export interface ImageToolLabel {
	label: string;
	score: number;
}

export interface ImageToolResponse {
	object: "image.tool";
	task: ImageToolTask;
	model: string;
	images?: ImageToolImage[];
	text?: string;
	detections?: ImageToolDetection[];
	/** Classification results, best first. */
	labels?: ImageToolLabel[];
}

// ---------------------------------------------------------------------------
// POST /v1/text/tools (Memorall extension): single-shot text tasks
// ---------------------------------------------------------------------------

export interface TextToolParams {
	model: string;
	task: TextToolTask;
	/** The text to classify, or the query to rank documents against. */
	input: string;
	options?: {
		/** Zero-shot: the labels to choose from. */
		labels?: string[];
		/** Zero-shot: score each label on its own instead of one winner. */
		multiLabel?: boolean;
		/** Zero-shot: how a label becomes a hypothesis, `{}` is the label. */
		hypothesisTemplate?: string;
		/** Ranking: the documents to order by relevance to `input`. */
		documents?: string[];
	};
	signal?: AbortSignal;
}

export interface TextToolRanking {
	/** Position of the document in the request. */
	index: number;
	document: string;
	/** Relevance, 0 - 1. */
	score: number;
}

export interface TextToolResponse {
	object: "text.tool";
	task: TextToolTask;
	model: string;
	/** Classification results, best first. */
	labels?: ImageToolLabel[];
	/** Ranking results, most relevant first. */
	ranking?: TextToolRanking[];
}
