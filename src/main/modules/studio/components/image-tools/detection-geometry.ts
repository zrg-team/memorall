import type { ImageToolDetection } from "@/types/openai-media";

export interface Size {
	width: number;
	height: number;
}

export interface BoxRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Inputs larger than this are refused before they reach the model. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export const DEFAULT_DETECTION_THRESHOLD = 0.5;
export const MIN_DETECTION_THRESHOLD = 0.1;
export const MAX_DETECTION_THRESHOLD = 0.95;

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

/**
 * Map a detection box from the input image's pixel space to the size the
 * image is displayed at.
 *
 * Detectors report coordinates of the image they were given, which is almost
 * never the size it is drawn at in a 360px panel. Boxes are clamped to the
 * image so a box that touches an edge never spills over the card.
 */
export function scaleDetectionBox(
	box: ImageToolDetection["box"],
	natural: Size,
	displayed: Size,
): BoxRect {
	if (natural.width <= 0 || natural.height <= 0) {
		return { left: 0, top: 0, width: 0, height: 0 };
	}
	const scaleX = displayed.width / natural.width;
	const scaleY = displayed.height / natural.height;
	const xmin = clamp(Math.min(box.xmin, box.xmax), 0, natural.width);
	const xmax = clamp(Math.max(box.xmin, box.xmax), 0, natural.width);
	const ymin = clamp(Math.min(box.ymin, box.ymax), 0, natural.height);
	const ymax = clamp(Math.max(box.ymin, box.ymax), 0, natural.height);
	return {
		left: xmin * scaleX,
		top: ymin * scaleY,
		width: (xmax - xmin) * scaleX,
		height: (ymax - ymin) * scaleY,
	};
}

/** Labels with how often each was found, most frequent first. */
export function countDetectionsByLabel(
	detections: ImageToolDetection[],
): Array<{ label: string; count: number }> {
	const counts = new Map<string, number>();
	for (const detection of detections) {
		counts.set(detection.label, (counts.get(detection.label) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * A stable hue per label, so every "person" box is the same colour across
 * cards and the eye can group them without reading chips.
 */
export function detectionHue(label: string): number {
	let hash = 0;
	for (let index = 0; index < label.length; index++) {
		hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
	}
	return hash % 360;
}

export const formatScore = (score: number) =>
	`${Math.round(clamp(score, 0, 1) * 100)}%`;

/**
 * The next compare-slider position for a key press, or null when the key is
 * not one the slider handles (so the event can bubble).
 */
export function stepComparePosition(
	position: number,
	key: string,
	large = false,
): number | null {
	const step = large ? 10 : 2;
	switch (key) {
		case "ArrowLeft":
		case "ArrowDown":
			return clamp(position - step, 0, 100);
		case "ArrowRight":
		case "ArrowUp":
			return clamp(position + step, 0, 100);
		case "PageDown":
			return clamp(position - 10, 0, 100);
		case "PageUp":
			return clamp(position + 10, 0, 100);
		case "Home":
			return 0;
		case "End":
			return 100;
		default:
			return null;
	}
}

/** Pointer x inside an element as a 0-100 slider position. */
export function positionFromPointer(
	clientX: number,
	rect: { left: number; width: number },
) {
	if (rect.width <= 0) return 50;
	return clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
}
