/**
 * What kind of work a model does.
 *
 * Chat was the only kind for a long time, so everything that predates this
 * file assumes it: a model with no declared categories is a chat model. Every
 * other category is served by the same providers through OpenAI-compatible
 * media endpoints (`/audio/speech`, `/audio/transcriptions`,
 * `/images/generations`) or the Memorall `/images/tools` and `/text/tools`
 * extensions.
 */
export type ModelCategory =
	| "chat"
	| "text-to-speech"
	| "speech-to-text"
	| "image-generation"
	| "image-tools"
	| "text-tools"
	| "text-to-audio"
	| "embedding";

/**
 * The categories the main panel can switch to. Embeddings stay inside the
 * embedding service; the category only exists so remote embedding models stop
 * showing up in the chat picker.
 */
export type WorkspaceMode = Exclude<ModelCategory, "embedding">;

/** Every workspace mode that is not chat. */
export type MediaCategory = Exclude<WorkspaceMode, "chat">;

/** Image-tools tasks, named after the pipeline tasks that serve them. */
export type ImageToolTask =
	| "background-removal"
	| "image-segmentation"
	| "depth-estimation"
	| "object-detection"
	| "image-to-text"
	| "image-classification";

/** Text-tools tasks, named after the Hub pipeline tags that serve them. */
export type TextToolTask =
	| "text-classification"
	| "zero-shot-classification"
	| "text-ranking";

export const WORKSPACE_MODES: readonly WorkspaceMode[] = [
	"chat",
	"text-to-speech",
	"speech-to-text",
	"image-generation",
	"image-tools",
	"text-tools",
	"text-to-audio",
];

export const MEDIA_CATEGORIES: readonly MediaCategory[] = [
	"text-to-speech",
	"speech-to-text",
	"image-generation",
	"image-tools",
	"text-tools",
	"text-to-audio",
];

export const IMAGE_TOOL_TASKS: readonly ImageToolTask[] = [
	"background-removal",
	"image-segmentation",
	"depth-estimation",
	"object-detection",
	"image-to-text",
	"image-classification",
];

export const TEXT_TOOL_TASKS: readonly TextToolTask[] = [
	"text-classification",
	"zero-shot-classification",
	"text-ranking",
];

export const DEFAULT_MODEL_CATEGORIES: readonly ModelCategory[] = ["chat"];

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
	return (
		typeof value === "string" &&
		(WORKSPACE_MODES as readonly string[]).includes(value)
	);
}

export function isMediaCategory(value: unknown): value is MediaCategory {
	return (
		typeof value === "string" &&
		(MEDIA_CATEGORIES as readonly string[]).includes(value)
	);
}

/** A model that never declared categories predates them, so it is chat. */
export function modelCategoriesOf(model: {
	categories?: readonly ModelCategory[];
}): readonly ModelCategory[] {
	return model.categories?.length ? model.categories : DEFAULT_MODEL_CATEGORIES;
}

export function modelSupportsCategory(
	model: { categories?: readonly ModelCategory[] },
	category: ModelCategory,
): boolean {
	return modelCategoriesOf(model).includes(category);
}
