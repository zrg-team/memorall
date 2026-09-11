import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
vi.stubGlobal("chrome", { runtime: { sendMessage } });

import {
	fitWithinMaxEdge,
	captureViewport,
	computeCropBox,
	RegionCaptureError,
} from "../capture-region";

const SOURCE = "memorall:capture-visible-tab";

describe("captureViewport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns what the tab is showing", async () => {
		sendMessage.mockResolvedValue({
			source: SOURCE,
			success: true,
			dataUrl: "data:image/png;base64,AAA",
		});

		await expect(captureViewport()).resolves.toBe("data:image/png;base64,AAA");
	});

	it("says a context-menu launch would fix a missing permission", async () => {
		// captureVisibleTab needs activeTab, which the user grants by starting
		// Memorall from the context menu. Saying so beats a blank rectangle.
		sendMessage.mockResolvedValue({
			source: SOURCE,
			success: false,
			error: "Either the '<all_urls>' or 'activeTab' permission is required.",
			needsActivation: true,
		});

		await expect(captureViewport()).rejects.toMatchObject({
			name: "RegionCaptureError",
			needsActivation: true,
		});
	});

	it("does not claim a permission problem for an unrelated failure", async () => {
		sendMessage.mockResolvedValue({
			source: SOURCE,
			success: false,
			error: "The page has no window to capture.",
			needsActivation: false,
		});

		await expect(captureViewport()).rejects.toMatchObject({
			needsActivation: false,
		});
	});

	it("fails cleanly when the background answers with nothing usable", async () => {
		sendMessage.mockResolvedValue(undefined);

		await expect(captureViewport()).rejects.toBeInstanceOf(RegionCaptureError);
	});
});

describe("fitWithinMaxEdge", () => {
	it("leaves a region that is already small enough alone", () => {
		expect(fitWithinMaxEdge(800, 600, 1568)).toEqual({
			width: 800,
			height: 600,
		});
	});

	it("never scales a region up to the ceiling", () => {
		expect(fitWithinMaxEdge(100, 50, 1568)).toEqual({ width: 100, height: 50 });
	});

	it("scales the long edge down and keeps the shape", () => {
		// A full-screen drag on a HiDPI 4K display, which is otherwise several
		// megabytes of base64 carried through the whole conversation.
		expect(fitWithinMaxEdge(3840, 2160, 1568)).toEqual({
			width: 1568,
			height: 882,
		});
	});

	it("does nothing without a ceiling", () => {
		expect(fitWithinMaxEdge(3840, 2160)).toEqual({
			width: 3840,
			height: 2160,
		});
	});
});

describe("computeCropBox", () => {
	const capture = { imageWidth: 2000, imageHeight: 1000, viewportWidth: 1000 };

	it("scales by the capture's own ratio, not devicePixelRatio", () => {
		// A 2000px capture of a 1000px viewport is 2x. Reading devicePixelRatio
		// instead goes wrong the moment the page is zoomed or the window moves
		// to a monitor with a different scale.
		expect(
			computeCropBox({
				...capture,
				rect: { left: 10, top: 20, width: 100, height: 50 },
			}),
		).toEqual({ left: 20, top: 40, width: 200, height: 100 });
	});

	it("handles a fractional scale from a zoomed page", () => {
		// Browser zoom makes the capture a non-integer multiple of the viewport,
		// so the crop has to round rather than assume whole pixels.
		expect(
			computeCropBox({
				imageWidth: 1250,
				imageHeight: 1000,
				viewportWidth: 1000,
				rect: { left: 10, top: 20, width: 101, height: 51 },
			}),
		).toEqual({ left: 13, top: 25, width: 126, height: 64 });
	});

	it("never cuts outside the captured image", () => {
		const box = computeCropBox({
			...capture,
			rect: { left: 900, top: 400, width: 9_999, height: 9_999 },
		});

		expect(box.left + box.width).toBeLessThanOrEqual(capture.imageWidth);
		expect(box.top + box.height).toBeLessThanOrEqual(capture.imageHeight);
	});

	it("keeps an empty selection to at least one pixel", () => {
		// A click without a drag would otherwise ask for a zero-sized canvas.
		const box = computeCropBox({
			...capture,
			rect: { left: 0, top: 0, width: 0, height: 0 },
		});

		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
	});

	it("clamps a region scrolled above the viewport to the top edge", () => {
		const box = computeCropBox({
			...capture,
			rect: { left: -50, top: -80, width: 100, height: 100 },
		});

		expect(box.left).toBe(0);
		expect(box.top).toBe(0);
	});

	it("treats a 1:1 capture as no scaling at all", () => {
		expect(
			computeCropBox({
				imageWidth: 1000,
				imageHeight: 800,
				viewportWidth: 1000,
				rect: { left: 5, top: 6, width: 7, height: 8 },
			}),
		).toEqual({ left: 5, top: 6, width: 7, height: 8 });
	});

	it("survives a viewport width of zero rather than dividing by it", () => {
		const box = computeCropBox({
			imageWidth: 100,
			imageHeight: 100,
			viewportWidth: 0,
			rect: { left: 1, top: 1, width: 10, height: 10 },
		});

		expect(Number.isFinite(box.width)).toBe(true);
		expect(box.width).toBeGreaterThan(0);
	});
});
