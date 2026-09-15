import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type {
	ImageToolTask,
	TextToolTask,
} from "@/services/llm/interfaces/model-category";
import type { MediaVoice } from "@/types/openai-media";

/**
 * What a studio may offer for a model, read only from what the model itself
 * reports (`ModelInfo`). No model is known by name: a provider that publishes
 * voices, languages or an image task gets the matching controls; one that
 * does not gets free-form inputs the server can accept or reject.
 */
export const voicesOf = (info: ModelInfo | undefined): MediaVoice[] =>
	info?.voices ?? [];

export const imageTaskOf = (
	info: ModelInfo | undefined,
): ImageToolTask | undefined => info?.imageTask;

export const textTaskOf = (
	info: ModelInfo | undefined,
): TextToolTask | undefined => info?.textTask;

export const languagesOf = (info: ModelInfo | undefined): string[] =>
	info?.languages ?? [];

/**
 * Only a model that declares its languages can be known to be English-only;
 * anything that does not say is treated as multilingual.
 */
export const isEnglishOnly = (info: ModelInfo | undefined): boolean => {
	const languages = languagesOf(info);
	return languages.length > 0 && languages.every((code) => code === "en");
};
