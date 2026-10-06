/**
 * Pictures of page elements, for the agent to look at: a canvas (a game, a
 * chart), an image, or any other part of a page. A picture is cut to the
 * element and scaled down until its longest side fits CAPTURE_MAX_SIDE.
 */

export interface MemonPageCapture {
	/** A PNG data URL. */
	dataUrl: string;
	width: number;
	height: number;
	/** An image's own address, when the element is one. */
	source?: string;
}

/**
 * Which element to picture: a ref of the outline the agent read. Without
 * one, the page as its viewport shows it.
 */
export interface MemonCaptureRequest {
	ref?: string;
	docToken?: string;
}

export interface CaptureRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The longest side a picture keeps: enough to read, light on tokens. */
export const CAPTURE_MAX_SIDE = 1024;
/** How long a canvas waits for its page to draw a frame before it is read anyway. */
const FRAME_WAIT_MS = 500;

type Picture = Omit<MemonPageCapture, "source">;

const newCanvas = (
	width: number,
	height: number,
): HTMLCanvasElement | OffscreenCanvas => {
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return new OffscreenCanvas(width, height);
};

const toDataUrl = async (
	canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<string> => {
	if ("toDataURL" in canvas) return canvas.toDataURL("image/png");
	const blob = await canvas.convertToBlob({ type: "image/png" });
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return `data:image/png;base64,${btoa(binary)}`;
};

/** `area` cut to what lies inside `size`. */
const within = (
	area: CaptureRect,
	size: { width: number; height: number },
): CaptureRect => {
	const x = Math.max(0, area.x);
	const y = Math.max(0, area.y);
	return {
		x,
		y,
		width: Math.min(area.x + area.width, size.width) - x,
		height: Math.min(area.y + area.height, size.height) - y,
	};
};

/**
 * Draws `area` of `source` (all of it by default), scaled to fit. The draw
 * happens before the first await, so a caller can read a WebGL canvas in
 * the same task the page drew it in.
 */
export const fitPicture = async (
	source: CanvasImageSource,
	size: { width: number; height: number },
	area?: CaptureRect,
): Promise<Picture> => {
	const crop = within(area ?? { x: 0, y: 0, ...size }, size);
	if (!(crop.width >= 1 && crop.height >= 1)) {
		throw new Error("The element is not on screen: scroll it into view first.");
	}
	const scale = Math.min(
		1,
		CAPTURE_MAX_SIDE / Math.max(crop.width, crop.height),
	);
	const width = Math.max(1, Math.round(crop.width * scale));
	const height = Math.max(1, Math.round(crop.height * scale));
	const canvas = newCanvas(width, height);
	const context = canvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!context) throw new Error("Pictures cannot be drawn here.");
	context.drawImage(
		source,
		crop.x,
		crop.y,
		crop.width,
		crop.height,
		0,
		0,
		width,
		height,
	);
	return { dataUrl: await toDataUrl(canvas), width, height };
};

/** `area` of a screenshot (a data URL), in the screenshot's own pixels. */
export const cropScreenshot = async (
	dataUrl: string,
	area: CaptureRect,
): Promise<Picture> => {
	const blob = await (await fetch(dataUrl)).blob();
	const bitmap = await createImageBitmap(blob);
	try {
		return await fitPicture(
			bitmap,
			{ width: bitmap.width, height: bitmap.height },
			area,
		);
	} finally {
		bitmap.close();
	}
};

/**
 * A canvas as the page last drew it. A WebGL canvas is blank between
 * frames, so it is read right after the page's next animation frame, in
 * the same task; a page that draws no frame is read after a moment anyway.
 */
const readCanvas = (canvas: HTMLCanvasElement): Promise<Picture> => {
	const view = canvas.ownerDocument.defaultView;
	const size = { width: canvas.width, height: canvas.height };
	if (!view) return fitPicture(canvas, size);
	return new Promise<Picture>((resolve, reject) => {
		const original = view.requestAnimationFrame;
		let read = false;
		const finish = () => {
			if (read) return;
			read = true;
			clearTimeout(timer);
			view.requestAnimationFrame = original;
			fitPicture(canvas, size).then(resolve, reject);
		};
		const timer = setTimeout(finish, FRAME_WAIT_MS);
		view.requestAnimationFrame = (callback) =>
			original.call(view, (time) => {
				try {
					callback(time);
				} finally {
					finish();
				}
			});
	});
};

/** An image file's bytes as a picture, scaled down as page pictures are. */
export const pictureOfImage = async (
	bytes: Uint8Array,
	mimeType: string,
): Promise<MemonPageCapture> => {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(
			new Blob([bytes as BlobPart], { type: mimeType }),
		);
	} catch {
		throw new Error("The image could not be decoded.");
	}
	try {
		return await fitPicture(bitmap, {
			width: bitmap.width,
			height: bitmap.height,
		});
	} finally {
		bitmap.close();
	}
};

/** The part of a page this window can reach that its viewport shows. */
export const captureViewport = async (
	doc: Document,
): Promise<MemonPageCapture> => {
	const view = doc.defaultView;
	const { default: html2canvas } = await import("html2canvas");
	const drawn = await html2canvas(doc.documentElement, {
		backgroundColor: null,
		logging: false,
		useCORS: true,
		scale: 1,
		...(view
			? {
					x: view.scrollX,
					y: view.scrollY,
					width: view.innerWidth,
					height: view.innerHeight,
					windowWidth: view.innerWidth,
					windowHeight: view.innerHeight,
				}
			: {}),
	});
	return fitPicture(drawn, { width: drawn.width, height: drawn.height });
};

/** A picture of an element of a page this window can reach (same origin). */
export const captureElement = async (
	element: Element,
	source?: string,
): Promise<MemonPageCapture> => {
	const tag = element.tagName.toLowerCase();
	let picture: Picture;
	if (tag === "canvas") {
		picture = await readCanvas(element as HTMLCanvasElement);
	} else if (
		tag === "img" &&
		(element as HTMLImageElement).complete &&
		(element as HTMLImageElement).naturalWidth > 0
	) {
		const image = element as HTMLImageElement;
		picture = await fitPicture(image, {
			width: image.naturalWidth,
			height: image.naturalHeight,
		});
	} else {
		const { default: html2canvas } = await import("html2canvas");
		const drawn = await html2canvas(element as HTMLElement, {
			backgroundColor: null,
			logging: false,
			useCORS: true,
			scale: 1,
		});
		picture = await fitPicture(drawn, {
			width: drawn.width,
			height: drawn.height,
		});
	}
	return source ? { ...picture, source } : picture;
};
