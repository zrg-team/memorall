/**
 * Turning a drag into a rectangle.
 *
 * Kept free of the DOM so the rules — which way the drag went, whether it is
 * big enough to mean anything, where the viewport cuts it off — can be tested
 * without a browser.
 *
 * Everything here is in CSS viewport pixels, the same space as `clientX` /
 * `clientY` and as `RegionRect` in ./capture-region. Device pixels are entered
 * only inside the capture crop.
 */

export interface DragPoint {
	x: number;
	y: number;
}

export interface DragRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * A drag under this size in either direction is treated as a stray click.
 *
 * Without it a mis-click attaches a 1x1 image, which looks like the feature
 * silently failed.
 */
export const MIN_SELECTION_PX = 10;

/**
 * The rectangle between two corners, whichever order they were dragged in.
 *
 * Dragging right-to-left or bottom-to-top describes the same region as the
 * opposite drag, so both normalise to one non-negative rect.
 */
export const normalizeDragRect = (
	start: DragPoint,
	end: DragPoint,
): DragRect => ({
	left: Math.min(start.x, end.x),
	top: Math.min(start.y, end.y),
	width: Math.abs(end.x - start.x),
	height: Math.abs(end.y - start.y),
});

/**
 * Trim a rect to what is actually on screen.
 *
 * A drag can leave the window — the pointer is captured, so the coordinates
 * keep going — and only the visible part of the page can be captured.
 */
export const clampRectToViewport = (
	rect: DragRect,
	viewportWidth: number,
	viewportHeight: number,
): DragRect => {
	const left = Math.min(Math.max(rect.left, 0), viewportWidth);
	const top = Math.min(Math.max(rect.top, 0), viewportHeight);
	const right = Math.min(Math.max(rect.left + rect.width, 0), viewportWidth);
	const bottom = Math.min(Math.max(rect.top + rect.height, 0), viewportHeight);

	return {
		left,
		top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
};

/** Whether a rect is too small to have been meant. */
export const isBelowMinimumSelection = (rect: DragRect): boolean =>
	rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX;

/** The size shown to the user while dragging. */
export const formatRectSize = (rect: DragRect): string =>
	`${Math.round(rect.width)} × ${Math.round(rect.height)}`;
