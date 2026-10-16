/**
 * Screenshots of a tab beyond what one capture of its viewport shows: a
 * rectangle of it, or the whole page top to bottom.
 *
 * `captureVisibleTab` only ever returns the viewport, as the compositor
 * painted it, so a whole page is captured a viewport at a time, scrolling
 * between captures, and the captures are drawn into one picture. Each is
 * still exactly what the browser showed: cross-origin images, canvases and
 * WebGL come out, unlike in a redraw of the DOM.
 *
 * What a page fixes to the screen (a header, a cookie bar) would show again
 * in every capture, so it is hidden after the first one and shown again
 * after the last; the page is scrolled back to where it was.
 */

import {
	type PageMetrics,
	screenshotArea,
	scrollStops,
	segmentPlacement,
	type WebScreenshotOptions,
} from "@/services/web-browser/page-screenshot";
import {
	isCapturePermissionError,
	screenCaptureWithheldMessage,
} from "@/services/web-browser/site-access";
import { nextCaptureSlot } from "./capture-slot";

/** Time for the page to paint after a scroll, before it is captured. */
const SCROLL_PAINT_MS = 250;
/** Marks what the screenshot hid, with the inline visibility to give back. */
const HIDDEN_MARK = "data-memorall-screenshot-hidden";

const delay = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** The viewport as the browser painted it, as a PNG data URL. */
export const captureVisible = async (windowId: number): Promise<string> => {
	await nextCaptureSlot();
	return chrome.tabs
		.captureVisibleTab(windowId, { format: "png" })
		.catch((error: unknown) => {
			// Said so the agent and the Browser can ask the user for it.
			const message = error instanceof Error ? error.message : String(error);
			if (isCapturePermissionError(message)) {
				throw new Error(screenCaptureWithheldMessage());
			}
			throw error;
		});
};

const inPage = async <Args extends unknown[], Result>(
	tabId: number,
	func: (...args: Args) => Result,
	...args: Args
): Promise<Awaited<Result>> => {
	const [injection] = await chrome.scripting.executeScript({
		target: { tabId, allFrames: false },
		func,
		args,
	});
	return injection?.result as Awaited<Result>;
};

// Run in the page: each is serialized on its own, so they share nothing.

const measurePage = (): PageMetrics & { windowWidth: number } => {
	const root =
		document.compatMode === "BackCompat" && document.body
			? document.body
			: document.documentElement;
	return {
		scrollX: window.scrollX,
		scrollY: window.scrollY,
		viewportWidth: root.clientWidth || window.innerWidth,
		viewportHeight: root.clientHeight || window.innerHeight,
		pageHeight: Math.max(
			document.documentElement.scrollHeight,
			document.body?.scrollHeight ?? 0,
		),
		devicePixelRatio: window.devicePixelRatio || 1,
		windowWidth: window.innerWidth,
	};
};

const scrollPage = (x: number, y: number): { x: number; y: number } => {
	window.scrollTo({ left: x, top: y, behavior: "instant" });
	return { x: window.scrollX, y: window.scrollY };
};

const hideFixed = (mark: string): number => {
	let hidden = 0;
	for (const element of document.querySelectorAll<HTMLElement>("body *")) {
		const { position } = getComputedStyle(element);
		if (position !== "fixed" && position !== "sticky") continue;
		element.setAttribute(
			mark,
			`${element.style.getPropertyValue("visibility")}|${element.style.getPropertyPriority("visibility")}`,
		);
		element.style.setProperty("visibility", "hidden", "important");
		hidden += 1;
	}
	return hidden;
};

const showFixed = (mark: string): void => {
	for (const element of document.querySelectorAll<HTMLElement>(`[${mark}]`)) {
		const [value = "", priority = ""] = (
			element.getAttribute(mark) ?? ""
		).split("|");
		if (value) element.style.setProperty("visibility", value, priority);
		else element.style.removeProperty("visibility");
		element.removeAttribute(mark);
	}
};

const pngDataUrl = async (blob: Blob): Promise<string> => {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:image/png;base64,${btoa(binary)}`;
};

const bitmapOf = async (dataUrl: string): Promise<ImageBitmap> =>
	createImageBitmap(await (await fetch(dataUrl)).blob());

/**
 * A rectangle of the tab's viewport, or of the whole page, as one PNG. The
 * tab must be the one its window shows.
 */
export const captureTabArea = async (
	tabId: number,
	windowId: number,
	options: WebScreenshotOptions,
): Promise<{
	dataUrl: string;
	width: number;
	height: number;
	cut: boolean;
}> => {
	const metrics = await inPage(tabId, measurePage);
	const planned = screenshotArea(options, metrics);
	if (!planned) {
		throw new Error(
			options.fullPage
				? "That rectangle is not on the page."
				: "That rectangle is not in the viewport: give x, y within it, or take the whole page.",
		);
	}
	const { area, cut } = planned;
	const viewport = {
		width: metrics.viewportWidth,
		height: metrics.viewportHeight,
	};
	// Only the whole page scrolls; a rectangle of the viewport is one capture.
	const stops = options.fullPage
		? scrollStops(area, metrics.viewportHeight, metrics.pageHeight)
		: [metrics.scrollY];

	let canvas: OffscreenCanvas | null = null;
	let context: OffscreenCanvasRenderingContext2D | null = null;
	let scale = 1;
	try {
		for (const [index, stop] of stops.entries()) {
			const scroll = options.fullPage
				? await inPage(tabId, scrollPage, 0, stop)
				: { x: metrics.scrollX, y: metrics.scrollY };
			if (index === 1) await inPage(tabId, hideFixed, HIDDEN_MARK);
			if (options.fullPage) await delay(SCROLL_PAINT_MS);
			const bitmap = await bitmapOf(await captureVisible(windowId));
			try {
				if (!canvas || !context) {
					// The capture's own pixels per CSS pixel: zoom and display included.
					scale = bitmap.width / metrics.windowWidth;
					canvas = new OffscreenCanvas(
						Math.max(1, Math.round(area.width * scale)),
						Math.max(1, Math.round(area.height * scale)),
					);
					context = canvas.getContext("2d");
					if (!context) throw new Error("The screenshot could not be drawn.");
				}
				const placement = segmentPlacement(area, scroll, viewport);
				if (!placement) continue;
				const { source, target } = placement;
				context.drawImage(
					bitmap,
					Math.round(source.x * scale),
					Math.round(source.y * scale),
					Math.round(source.width * scale),
					Math.round(source.height * scale),
					Math.round(target.x * scale),
					Math.round(target.y * scale),
					Math.round(source.width * scale),
					Math.round(source.height * scale),
				);
			} finally {
				bitmap.close();
			}
		}
	} finally {
		if (options.fullPage) {
			await inPage(tabId, showFixed, HIDDEN_MARK).catch(() => undefined);
			await inPage(tabId, scrollPage, metrics.scrollX, metrics.scrollY).catch(
				() => undefined,
			);
		}
	}
	if (!canvas) throw new Error("The page could not be captured.");
	return {
		dataUrl: await pngDataUrl(
			await canvas.convertToBlob({ type: "image/png" }),
		),
		width: canvas.width,
		height: canvas.height,
		cut,
	};
};
