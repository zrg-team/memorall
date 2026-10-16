/**
 * Which part of a page a screenshot keeps, and how a picture taller than the
 * viewport is put together from captures of the viewport. Pure geometry, in
 * CSS pixels: the extension's background takes its pictures by it.
 */

export interface ScreenshotRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WebScreenshotOptions {
	/** The whole page, top to bottom, not only what the viewport shows. */
	fullPage?: boolean;
	/**
	 * A rectangle: of the viewport, or with `fullPage`, of the page from its
	 * top-left corner.
	 */
	clip?: ScreenshotRect;
}

export interface PageMetrics {
	scrollX: number;
	scrollY: number;
	/** The viewport without its scrollbars. */
	viewportWidth: number;
	viewportHeight: number;
	pageHeight: number;
	devicePixelRatio: number;
}

/** The tallest picture a screenshot makes, in image pixels: a longer page is cut. */
export const SCREENSHOT_MAX_HEIGHT = 16_384;

export const intersectRects = (
	a: ScreenshotRect,
	b: ScreenshotRect,
): ScreenshotRect | null => {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const width = Math.min(a.x + a.width, b.x + b.width) - x;
	const height = Math.min(a.y + a.height, b.y + b.height) - y;
	return width >= 1 && height >= 1 ? { x, y, width, height } : null;
};

/** The rectangle between two corners, in either order. */
export const rectBetween = (
	from: { x: number; y: number },
	to: { x: number; y: number },
): ScreenshotRect => ({
	x: Math.min(from.x, to.x),
	y: Math.min(from.y, to.y),
	width: Math.abs(to.x - from.x),
	height: Math.abs(to.y - from.y),
});

/**
 * The part of the page to keep, in page coordinates, and whether it was cut
 * to SCREENSHOT_MAX_HEIGHT. Null when the rectangle is off the viewport (or,
 * with `fullPage`, off the page).
 */
export const screenshotArea = (
	options: WebScreenshotOptions,
	metrics: PageMetrics,
): { area: ScreenshotRect; cut: boolean } | null => {
	const bounds: ScreenshotRect = options.fullPage
		? {
				x: 0,
				y: 0,
				width: metrics.viewportWidth,
				height: Math.max(metrics.pageHeight, metrics.viewportHeight),
			}
		: {
				x: metrics.scrollX,
				y: metrics.scrollY,
				width: metrics.viewportWidth,
				height: metrics.viewportHeight,
			};
	const clip = options.clip;
	const wanted =
		clip && !options.fullPage
			? { ...clip, x: clip.x + metrics.scrollX, y: clip.y + metrics.scrollY }
			: (clip ?? bounds);
	const area = intersectRects(wanted, bounds);
	if (!area) return null;
	const maxHeight = Math.floor(
		SCREENSHOT_MAX_HEIGHT / Math.max(metrics.devicePixelRatio, 0.25),
	);
	return area.height > maxHeight
		? { area: { ...area, height: maxHeight }, cut: true }
		: { area, cut: false };
};

/** The scroll positions whose viewports cover `area`, top to bottom. */
export const scrollStops = (
	area: ScreenshotRect,
	viewportHeight: number,
	pageHeight: number,
): number[] => {
	const last = Math.max(0, pageHeight - viewportHeight);
	const stops: number[] = [];
	for (let y = area.y; ; y += viewportHeight) {
		const stop = Math.min(y, last);
		if (stops[stops.length - 1] !== stop) stops.push(stop);
		if (y + viewportHeight >= area.y + area.height || stop === last) {
			return stops;
		}
	}
};

/**
 * Where a capture of the viewport scrolled to `scroll` goes in the picture
 * of `area`: the part of the capture it keeps, and where that lands in the
 * picture. Null when the capture shows nothing of the area.
 */
export const segmentPlacement = (
	area: ScreenshotRect,
	scroll: { x: number; y: number },
	viewport: { width: number; height: number },
): { source: ScreenshotRect; target: { x: number; y: number } } | null => {
	const part = intersectRects(area, { ...scroll, ...viewport });
	if (!part) return null;
	return {
		source: { ...part, x: part.x - scroll.x, y: part.y - scroll.y },
		target: { x: part.x - area.x, y: part.y - area.y },
	};
};
