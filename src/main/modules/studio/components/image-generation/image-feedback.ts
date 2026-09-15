import type {
	ImageComment,
	ImageRegion,
	StudioContentPart,
	StudioItem,
} from "@/types/studio";

/** Drags smaller than this (of the image's width or height) are clicks. */
export const MIN_REGION_FRACTION = 0.02;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The region between two points given as fractions of the image; null if too small. */
export function regionBetween(
	start: { x: number; y: number },
	end: { x: number; y: number },
): ImageRegion | null {
	const x = clamp01(Math.min(start.x, end.x));
	const y = clamp01(Math.min(start.y, end.y));
	const width = clamp01(Math.max(start.x, end.x)) - x;
	const height = clamp01(Math.max(start.y, end.y)) - y;
	if (width < MIN_REGION_FRACTION || height < MIN_REGION_FRACTION) return null;
	return { x, y, width, height };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Where a region is, in words a model reads without seeing any overlay. */
export function describeRegion(region: ImageRegion): string {
	return `from ${percent(region.x)} to ${percent(region.x + region.width)} across, ${percent(region.y)} to ${percent(region.y + region.height)} down`;
}

/**
 * The prompt for the next image. The first image is the one to change; with a
 * marked copy, the second shows each numbered region as a box, which the
 * model must use to find the regions but never reproduce.
 */
export function composeFeedbackPrompt(
	basePrompt: string,
	comments: readonly ImageComment[],
	options: { markedCopy: boolean },
): string {
	const notes = comments.map((comment, index) => {
		const where = comment.region
			? `area ${index + 1}, ${describeRegion(comment.region)}`
			: "whole image";
		return `${index + 1}. (${where}) ${comment.text.trim()}`;
	});
	return [
		"Create the next version of the attached image, applying this feedback.",
		basePrompt.trim() ? `Original prompt: ${basePrompt.trim()}` : null,
		"",
		"Feedback:",
		...notes,
		"",
		"Keep everything the feedback does not mention as it is: subject, composition, style and colors.",
		options.markedCopy
			? "The second image is the same picture with each numbered area outlined. Use it only to find the areas; do not draw the outlines or numbers."
			: null,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

export const commentsOf = (
	item: StudioItem,
	imagePath: string,
): ImageComment[] => {
	for (const part of item.parts) {
		if (part.type === "image_comments" && part.imagePath === imagePath) {
			return part.comments;
		}
	}
	return [];
};

/** The item's parts with one image's comments replaced (removed when empty). */
export function withComments(
	parts: readonly StudioContentPart[],
	imagePath: string,
	comments: readonly ImageComment[],
): StudioContentPart[] {
	const others = parts.filter(
		(part) => !(part.type === "image_comments" && part.imagePath === imagePath),
	);
	return comments.length > 0
		? [
				...others,
				{ type: "image_comments", imagePath, comments: [...comments] },
			]
		: others;
}

export const feedbackOf = (item: StudioItem) => {
	for (const part of item.parts) {
		if (part.type === "image_feedback") return part.feedback;
	}
	return undefined;
};

/** The prompt a follow-up is based on: the first prompt of the chain. */
export const basePromptOf = (item: StudioItem): string =>
	feedbackOf(item)?.basePrompt ?? item.content;

export const MARKER_COLOR = "#f59e0b";
