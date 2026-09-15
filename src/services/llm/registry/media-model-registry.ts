import type { ModelInfo } from "../interfaces/base-llm";
import type {
	MediaModelConfig,
	MediaPipelineTask,
} from "../interfaces/media-model-config";
import type {
	ImageToolTask,
	MediaCategory,
	ModelCategory,
	TextToolTask,
} from "../interfaces/model-category";
import { modelCategoriesOf } from "../interfaces/model-category";
import { PROVIDER_REGISTRY, isKnownProvider } from "../provider-registry";
import { classifyRemoteModel } from "../utils/remote-model-categories";

/**
 * Which studio each pipeline task belongs to. This is the whole mapping from
 * "a model" to "what the app does with it": nothing below knows any model by
 * name.
 */
export const TASK_CATEGORY: Readonly<Record<MediaPipelineTask, MediaCategory>> =
	{
		"text-to-speech": "text-to-speech",
		"text-to-audio": "text-to-audio",
		"automatic-speech-recognition": "speech-to-text",
		"background-removal": "image-tools",
		"image-segmentation": "image-tools",
		"depth-estimation": "image-tools",
		"object-detection": "image-tools",
		"image-to-text": "image-tools",
		"image-classification": "image-tools",
		"text-classification": "text-tools",
		"zero-shot-classification": "text-tools",
		"text-ranking": "text-tools",
	};

/** Hub pipeline tags to search for each studio. */
export const CATEGORY_TASKS: Readonly<
	Partial<Record<MediaCategory, MediaPipelineTask[]>>
> = Object.entries(TASK_CATEGORY).reduce(
	(accumulator, [task, category]) => {
		(accumulator[category] ??= []).push(task as MediaPipelineTask);
		return accumulator;
	},
	{} as Partial<Record<MediaCategory, MediaPipelineTask[]>>,
);

export const isMediaPipelineTask = (
	value: unknown,
): value is MediaPipelineTask =>
	typeof value === "string" && value in TASK_CATEGORY;

/** Image-tools tasks are pipeline tasks; the names are shared on purpose. */
export const imageToolTaskOf = (
	config: Pick<MediaModelConfig, "task">,
): ImageToolTask | undefined =>
	TASK_CATEGORY[config.task] === "image-tools"
		? (config.task as ImageToolTask)
		: undefined;

/** Text-tools tasks are pipeline tasks too. */
export const textToolTaskOf = (
	config: Pick<MediaModelConfig, "task">,
): TextToolTask | undefined =>
	TASK_CATEGORY[config.task] === "text-tools"
		? (config.task as TextToolTask)
		: undefined;

/**
 * What a model served by `serviceName` does.
 *
 * Categories the runner reported win; a provider with a single category needs
 * no guessing; hosted providers classify the id generically; anything else is
 * chat.
 */
export function resolveModelCategories(
	serviceName: string,
	modelId: string,
	info?: Pick<ModelInfo, "categories">,
): readonly ModelCategory[] {
	if (info?.categories?.length) {
		return modelCategoriesOf(info);
	}

	if (isKnownProvider(serviceName)) {
		const descriptor = PROVIDER_REGISTRY[serviceName];
		if (descriptor.categories.length === 1) {
			return descriptor.categories;
		}
		if (!descriptor.residentLocal) {
			return classifyRemoteModel(modelId);
		}
		// A multi-category local runner reports categories on every model; one
		// without them is unknown, not chat.
		if (!descriptor.categories.includes("chat")) {
			return [];
		}
	}

	return ["chat"];
}

/** The category a successful serve records the model under, if known. */
export function primaryCategoryOf(
	serviceName: string,
	modelId: string,
	info?: Pick<ModelInfo, "categories">,
): ModelCategory | null {
	return resolveModelCategories(serviceName, modelId, info)[0] ?? null;
}
