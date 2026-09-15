import { readStoredMedia } from "@/services/llm/utils/media-persistence";
import type { MediaPayload } from "@/types/openai-media";
import type { ImageComment, StudioContentPart } from "@/types/studio";
import { saveStudioInput } from "../../services/studio-service";
import { renderEditMask, renderMarkedImage } from "./image-feedback-canvas";
import { composeFeedbackPrompt } from "./image-feedback";

type StoredPayload = Extract<MediaPayload, { kind: "file" }>;

export interface FeedbackRequest {
	prompt: string;
	references: StoredPayload[];
	mask?: StoredPayload;
	inputParts: StudioContentPart[];
}

export interface FeedbackSource {
	itemId: string;
	path: string;
	mimeType: string;
}

/**
 * Everything the next image is made from: the source image, a copy with the
 * commented regions numbered, and, when every comment is about a region, a
 * mask that limits the change to those regions. The copy and the mask belong
 * to the new item; the source stays with the item that made it.
 */
export async function buildFeedbackRequest(
	source: FeedbackSource,
	basePrompt: string,
	comments: readonly ImageComment[],
): Promise<FeedbackRequest> {
	const regions = comments.flatMap((comment) =>
		comment.region ? [comment.region] : [],
	);
	let marked: StoredPayload | undefined;
	let mask: StoredPayload | undefined;
	if (regions.length > 0) {
		const bytes = await readStoredMedia(source.path);
		marked = await saveStudioInput(
			await renderMarkedImage(bytes, source.mimeType, comments),
			"image",
		);
		if (regions.length === comments.length) {
			mask = await saveStudioInput(
				await renderEditMask(bytes, source.mimeType, regions),
				"image",
			);
		}
	}
	const reference: StoredPayload = {
		kind: "file",
		path: source.path,
		mimeType: source.mimeType,
	};
	return {
		prompt: composeFeedbackPrompt(basePrompt, comments, {
			markedCopy: Boolean(marked),
		}),
		references: marked ? [reference, marked] : [reference],
		mask,
		inputParts: [
			{
				type: "image_feedback",
				feedback: { basePrompt, source, comments: [...comments] },
			},
			...(marked
				? [
						{
							type: "image" as const,
							image: {
								path: marked.path,
								mimeType: marked.mimeType,
								role: "input" as const,
							},
						},
					]
				: []),
			...(mask
				? [
						{
							type: "image" as const,
							image: {
								path: mask.path,
								mimeType: mask.mimeType,
								role: "mask" as const,
							},
						},
					]
				: []),
		],
	};
}
