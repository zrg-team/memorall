import type { MediaVoice } from "@/types/openai-media";
import type { DecisionModelVariant } from "../registry/decision-model-layout";
import type { DeviceDownloadSizes } from "./base-llm";
import type { MediaCategory } from "./model-category";

export type MediaProvider = "transformer-media";

/**
 * transformers.js pipeline tasks the media runner drives. Each maps to one
 * studio; which architecture serves it is transformers.js's business.
 */
export type MediaPipelineTask =
	| "text-to-speech"
	| "text-to-audio"
	| "automatic-speech-recognition"
	| "background-removal"
	| "image-segmentation"
	| "depth-estimation"
	| "object-detection"
	| "image-to-text"
	| "image-classification"
	| "text-classification"
	| "zero-shot-classification"
	| "text-ranking"
	/**
	 * Typed decisions (`/systemone`). Not a transformers.js pipeline: the
	 * runner drives the repo's ONNX graphs itself (see decision-model-layout).
	 */
	| "typed-decisions";

/**
 * A Hub model the user added to a media studio.
 *
 * Built from the repository's own metadata (pipeline tag, languages, files),
 * never from a hand-written entry: any repo transformers.js can run for the
 * task works the same way.
 */
export interface MediaModelConfig {
	/** Hub repo id. */
	id: string;
	provider: MediaProvider;
	task: MediaPipelineTask;
	category: MediaCategory;
	displayName: string;
	/** Estimated download in full precision (see `sizeByDevice`). */
	sizeBytes?: number;
	/** Estimated download for the precision each device loads by default. */
	sizeByDevice?: DeviceDownloadSizes;
	/** From the model card; absent when the card does not say. */
	languages?: string[];
	license?: string;
	/** Speaker-embedding files shipped in the repo, offered as voices. */
	voices?: MediaVoice[];
	/** Per-model overrides; unset lets transformers.js pick for the device. */
	dtype?: string | Record<string, string>;
	device?: "webgpu" | "wasm" | "auto";
	/** Typed-decision repos: the models found in the repo and the one in use. */
	decision?: { variants: DecisionModelVariant[]; variant?: string };
	addedAt: string;
}
