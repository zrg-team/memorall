import type {
	ImageToolDetection,
	ImageToolLabel,
	TextToolRanking,
	TranscriptionSegment,
} from "@/types/openai-media";
import type {
	ImageToolTask,
	TextToolTask,
	MediaCategory,
	WorkspaceMode,
} from "@/services/llm/interfaces/model-category";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

/** A part of an image, as fractions (0 - 1) of its width and height. */
export interface ImageRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A note on a generated image, about all of it or one region. */
export interface ImageComment {
	id: string;
	text: string;
	region?: ImageRegion;
	createdAt: number;
}

/**
 * One piece of a studio generation, stored in `messages.complex_content`.
 *
 * Kept apart from the chat content parts on purpose: chat parts are sent back
 * to a language model, and these never are (studio messages use their own
 * `type`, which `isNonModelMessageType` excludes from every chat prompt).
 * Media is always a documents-filesystem path, never inline base64.
 */
export type StudioContentPart =
	| { type: "text"; text: string; role?: "prompt" | "transcript" | "caption" }
	| {
			type: "input_audio";
			input_audio: {
				path: string;
				mimeType: string;
				durationMs?: number;
				name?: string;
			};
	  }
	| {
			type: "output_audio";
			output_audio: {
				path: string;
				mimeType: string;
				sampleRate?: number;
				durationMs?: number;
				voice?: string;
			};
	  }
	| {
			type: "image";
			image: {
				path: string;
				mimeType: string;
				role: "input" | "generated" | "mask" | "cutout" | "depth";
				/** Segment label, for segmentation masks. */
				label?: string;
				width?: number;
				height?: number;
			};
	  }
	/** Notes on one of this item's images, not yet used for a new image. */
	| { type: "image_comments"; imagePath: string; comments: ImageComment[] }
	/**
	 * What a follow-up image was made from. The source belongs to its own item,
	 * so it is referenced, never owned (deleting this item keeps it).
	 */
	| {
			type: "image_feedback";
			feedback: {
				basePrompt: string;
				source: { path: string; mimeType: string; itemId: string };
				comments: ImageComment[];
			};
	  }
	| { type: "segments"; segments: TranscriptionSegment[]; language?: string }
	| { type: "detections"; detections: ImageToolDetection[] }
	| { type: "labels"; labels: ImageToolLabel[] }
	| { type: "ranking"; ranking: TextToolRanking[] };

/** `messages.type` for each studio. Never a chat message type. */
export const STUDIO_MESSAGE_TYPES: Record<MediaCategory, string> = {
	"text-to-speech": "speech",
	"speech-to-text": "transcription",
	"image-generation": "image_generation",
	"image-tools": "image_tool",
	"text-tools": "text_tool",
	"text-to-audio": "text_to_audio",
};

export const STUDIO_MESSAGE_TYPE_SET: ReadonlySet<string> = new Set(
	Object.values(STUDIO_MESSAGE_TYPES),
);

export type StudioGenerationStatus =
	| "running"
	| "done"
	| "failed"
	| "cancelled";

/** `messages.metadata.generation`. */
export interface StudioGenerationMetadata {
	category: MediaCategory;
	provider: ServiceProvider;
	serviceName: string;
	modelId: string;
	status: StudioGenerationStatus;
	error?: string;
	/** Wall-clock time the generation took. */
	durationMs?: number;
	params?: Record<string, unknown>;
	imageTask?: ImageToolTask;
	textTask?: TextToolTask;
}

export interface StudioItem {
	id: string;
	conversationId: string;
	category: MediaCategory;
	/** Prompt, transcript or caption - whatever text the generation is about. */
	content: string;
	parts: StudioContentPart[];
	generation: StudioGenerationMetadata;
	createdAt: Date;
}

export const isStudioMode = (mode: WorkspaceMode): mode is MediaCategory =>
	mode !== "chat";
