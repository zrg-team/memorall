import { describe, expect, it } from "vitest";
import {
	type PageMetrics,
	rectBetween,
	SCREENSHOT_MAX_HEIGHT,
	screenshotArea,
	scrollStops,
	segmentPlacement,
} from "../page-screenshot";

const metrics: PageMetrics = {
	scrollX: 0,
	scrollY: 400,
	viewportWidth: 1280,
	viewportHeight: 800,
	pageHeight: 3000,
	devicePixelRatio: 1,
};

describe("which part of the page a screenshot keeps", () => {
	it("keeps the viewport, a rectangle of it, or the whole page", () => {
		expect(screenshotArea({}, metrics)).toEqual({
			area: { x: 0, y: 400, width: 1280, height: 800 },
			cut: false,
		});
		// A rectangle is of the viewport, as the screen's positions are.
		expect(
			screenshotArea(
				{ clip: { x: 10, y: 20, width: 300, height: 100 } },
				metrics,
			),
		).toEqual({ area: { x: 10, y: 420, width: 300, height: 100 }, cut: false });
		expect(screenshotArea({ fullPage: true }, metrics)).toEqual({
			area: { x: 0, y: 0, width: 1280, height: 3000 },
			cut: false,
		});
		// With the whole page, it is of the page from its top.
		expect(
			screenshotArea(
				{ fullPage: true, clip: { x: 0, y: 2900, width: 500, height: 400 } },
				metrics,
			),
		).toEqual({ area: { x: 0, y: 2900, width: 500, height: 100 }, cut: false });
	});

	it("refuses a rectangle off the viewport, and cuts a page too long to keep", () => {
		expect(
			screenshotArea(
				{ clip: { x: 0, y: 900, width: 100, height: 100 } },
				metrics,
			),
		).toBeNull();
		const long = screenshotArea(
			{ fullPage: true },
			{ ...metrics, pageHeight: 50_000, devicePixelRatio: 2 },
		);
		expect(long).toEqual({
			area: { x: 0, y: 0, width: 1280, height: SCREENSHOT_MAX_HEIGHT / 2 },
			cut: true,
		});
	});

	it("takes the corners in either order", () => {
		expect(rectBetween({ x: 400, y: 300 }, { x: 10, y: 20 })).toEqual({
			x: 10,
			y: 20,
			width: 390,
			height: 280,
		});
	});
});

describe("a picture taller than the viewport", () => {
	it("scrolls a viewport at a time, the last one to the page's end", () => {
		const page = { x: 0, y: 0, width: 1280, height: 3000 };
		expect(scrollStops(page, 800, 3000)).toEqual([0, 800, 1600, 2200]);
		expect(scrollStops({ ...page, y: 500, height: 200 }, 800, 3000)).toEqual([
			500,
		]);
		// A page shorter than its viewport is one capture.
		expect(scrollStops({ ...page, height: 600 }, 800, 600)).toEqual([0]);
	});

	it("keeps of each capture only what the picture still needs", () => {
		const area = { x: 0, y: 0, width: 1280, height: 3000 };
		const viewport = { width: 1280, height: 800 };
		expect(segmentPlacement(area, { x: 0, y: 800 }, viewport)).toEqual({
			source: { x: 0, y: 0, width: 1280, height: 800 },
			target: { x: 0, y: 800 },
		});
		// The last capture stops at the page's end and overlaps the one before.
		expect(segmentPlacement(area, { x: 0, y: 2200 }, viewport)).toEqual({
			source: { x: 0, y: 0, width: 1280, height: 800 },
			target: { x: 0, y: 2200 },
		});
		const part = { x: 100, y: 1000, width: 200, height: 100 };
		expect(segmentPlacement(part, { x: 0, y: 800 }, viewport)).toEqual({
			source: { x: 100, y: 200, width: 200, height: 100 },
			target: { x: 0, y: 0 },
		});
		expect(segmentPlacement(part, { x: 0, y: 0 }, viewport)).toBeNull();
	});
});
