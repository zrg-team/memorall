/**
 * Turning part of the page into a picture.
 *
 * Two ways exist and only one of them tells the truth. html2canvas re-renders
 * the DOM from computed styles, so an image served from another origin without a
 * CORS header — every map tile, most CDN images — is silently left out: the
 * result is white where the content was, no error raised, and every image is
 * re-requested twice on the way. `captureVisibleTab` hands back what the
 * compositor already painted, so cross-origin images, `<canvas>`, WebGL and
 * iframes all come out, at no extra requests.
 *
 * The trade is permission, not fidelity: `captureVisibleTab` needs an activeTab
 * grant, which the user gives by starting Memorall from the context menu. When
 * it is missing this reports that rather than falling back to a blank rectangle.
 */

import {
	isViewportCaptureResponse,
	VIEWPORT_CAPTURE_SOURCE,
} from "@/background/viewport-capture-handler";

export interface CapturedRegion {
	/** PNG data URL, cropped to the requested region. */
	dataUrl: string;
	width: number;
	height: number;
}

export class RegionCaptureError extends Error {
	/** True when a context-menu launch would earn the permission and fix this. */
	readonly needsActivation: boolean;

	constructor(message: string, needsActivation: boolean) {
		super(message);
		this.name = "RegionCaptureError";
		this.needsActivation = needsActivation;
	}
}

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("The capture could not be read."));
		image.src = dataUrl;
	});

/** The whole visible tab, exactly as painted. */
export const captureViewport = async (): Promise<string> => {
	const response = await chrome.runtime.sendMessage({
		source: VIEWPORT_CAPTURE_SOURCE,
	});
	if (!isViewportCaptureResponse(response)) {
		throw new RegionCaptureError("The page could not be captured.", false);
	}
	if (!response.success) {
		throw new RegionCaptureError(response.error, response.needsActivation);
	}
	return response.dataUrl;
};

export interface RegionRect {
	/** CSS pixels, relative to the viewport. */
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Crop a capture to one region.
 *
 * The capture is in device pixels and the rect is in CSS pixels, so the scale
 * is taken from the image itself rather than `devicePixelRatio` — a zoomed page
 * or a moved window makes the two disagree.
 */
export interface CropBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Where to cut, in the capture's own pixels.
 *
 * Separated from the drawing so the arithmetic can be tested without a canvas.
 * The scale comes from the image rather than `devicePixelRatio` because a zoomed
 * page or a window moved between monitors makes the two disagree, and the image
 * is the thing actually being cut.
 */
export const computeCropBox = ({
	imageWidth,
	imageHeight,
	viewportWidth,
	rect,
}: {
	imageWidth: number;
	imageHeight: number;
	viewportWidth: number;
	rect: RegionRect;
}): CropBox => {
	const scale = viewportWidth > 0 ? imageWidth / viewportWidth || 1 : 1;
	const left = Math.min(
		Math.max(0, Math.round(rect.left * scale)),
		Math.max(0, imageWidth - 1),
	);
	const top = Math.min(
		Math.max(0, Math.round(rect.top * scale)),
		Math.max(0, imageHeight - 1),
	);
	return {
		left,
		top,
		width: Math.min(
			Math.max(1, Math.round(rect.width * scale)),
			imageWidth - left,
		),
		height: Math.min(
			Math.max(1, Math.round(rect.height * scale)),
			imageHeight - top,
		),
	};
};

/**
 * How far a captured region is scaled down before it is attached.
 *
 * A full-viewport drag on a HiDPI 4K display is several megabytes of base64
 * that then rides along in every turn of the conversation. Models do not read
 * more detail than this anyway, so the ceiling costs nothing legible.
 */
export const DEFAULT_MAX_CAPTURE_EDGE = 1568;

/** The size to draw a crop at, never scaling it up. */
export const fitWithinMaxEdge = (
	width: number,
	height: number,
	maxEdge?: number,
): { width: number; height: number } => {
	const longest = Math.max(width, height);
	if (!maxEdge || longest <= maxEdge) {
		return { width, height };
	}
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
};

export const cropCapture = async (
	dataUrl: string,
	rect: RegionRect,
	options: { maxEdge?: number } = {},
): Promise<CapturedRegion> => {
	const image = await loadImage(dataUrl);
	const { left, top, width, height } = computeCropBox({
		imageWidth: image.width,
		imageHeight: image.height,
		viewportWidth: window.innerWidth,
		rect,
	});
	const target = fitWithinMaxEdge(width, height, options.maxEdge);

	const canvas = document.createElement("canvas");
	canvas.width = target.width;
	canvas.height = target.height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new RegionCaptureError("The image could not be cropped.", false);
	}
	context.drawImage(
		image,
		left,
		top,
		width,
		height,
		0,
		0,
		target.width,
		target.height,
	);

	return {
		dataUrl: canvas.toDataURL("image/png"),
		width: target.width,
		height: target.height,
	};
};

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * A picture of one element.
 *
 * Only what is on screen can be captured, so the element is brought into view
 * first and the crop is clamped to the viewport — a region taller than the
 * window comes back as the visible part rather than failing.
 */
export const captureElementRegion = async (
	element: Element,
	options: { hide?: HTMLElement[] } = {},
): Promise<CapturedRegion> => {
	element.scrollIntoView({ block: "nearest", inline: "nearest" });
	// Let the scroll and any overlay hiding paint before the capture is taken.
	await nextFrame();
	await nextFrame();

	const hidden = (options.hide ?? []).map((node) => {
		const previous = node.style.visibility;
		node.style.visibility = "hidden";
		return { node, previous };
	});

	try {
		await nextFrame();
		const dataUrl = await captureViewport();
		const box = element.getBoundingClientRect();
		const left = Math.max(0, box.left);
		const top = Math.max(0, box.top);
		return await cropCapture(dataUrl, {
			left,
			top,
			width: Math.min(box.width, window.innerWidth - left),
			height: Math.min(box.height, window.innerHeight - top),
		});
	} finally {
		for (const { node, previous } of hidden) {
			node.style.visibility = previous;
		}
	}
};
