import type { AttachedDocumentRef } from "@/types/chat";
import { logWarn } from "@/utils/logger";

/**
 * A picture of the computer's desktop for the chat. html2canvas redraws the
 * DOM from computed styles and cannot read CSS Color 4 functions, which the
 * app's styles resolve to (oklch), so the clone it draws gets plain rgba.
 */

const COLOR_FUNCTION = /\b(?:oklch|oklab|lch|lab|color)\([^()]*\)/;
const COLOR_FUNCTIONS = new RegExp(COLOR_FUNCTION.source, "g");
const COLOR_PROPERTIES = [
	"color",
	"background-color",
	"background-image",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"outline-color",
	"text-decoration-color",
	"box-shadow",
	"caret-color",
	"text-shadow",
	"-webkit-text-stroke-color",
	"-webkit-text-fill-color",
	"column-rule-color",
	"fill",
	"stroke",
];
const PSEUDO_ELEMENTS = ["::before", "::after"] as const;
const PSEUDO_MARK = "data-memon-capture";

/** Any CSS color as rgba, read back from a one-pixel canvas. */
const createRgbaConverter = (): ((color: string) => string) => {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	const cache = new Map<string, string>();
	return (color) => {
		const known = cache.get(color);
		if (known) return known;
		if (!context) return color;
		context.clearRect(0, 0, 1, 1);
		context.fillStyle = "rgba(0, 0, 0, 0)";
		context.fillStyle = color;
		context.fillRect(0, 0, 1, 1);
		const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
		const rgba = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
		cache.set(color, rgba);
		return rgba;
	};
};

/** A style value with each CSS Color 4 function replaced. */
export const rewriteColors = (
	value: string,
	toRgba: (color: string) => string,
): string => value.replace(COLOR_FUNCTIONS, toRgba);

/** The color properties of a computed style that need rewriting. */
const colorOverrides = (
	computed: CSSStyleDeclaration,
	toRgba: (color: string) => string,
): Array<[string, string]> =>
	COLOR_PROPERTIES.flatMap((property): Array<[string, string]> => {
		const value = computed.getPropertyValue(property);
		return value && COLOR_FUNCTION.test(value)
			? [[property, rewriteColors(value, toRgba)]]
			: [];
	});

/**
 * Rewrites the clone's colors as rgba so html2canvas can draw them: inline on
 * each element, and as generated rules for ::before / ::after content, which
 * html2canvas draws from the pseudo-element's own style.
 */
export const flattenColors = (
	root: Element,
	view: Window,
	toRgba: (color: string) => string = createRgbaConverter(),
): void => {
	const pseudoRules: string[] = [];
	let marks = 0;
	for (const element of [root, ...root.querySelectorAll("*")]) {
		const styled = element as Element & ElementCSSInlineStyle;
		if (!styled.style) continue;
		for (const [property, value] of colorOverrides(
			view.getComputedStyle(element),
			toRgba,
		)) {
			styled.style.setProperty(property, value);
		}
		for (const pseudo of PSEUDO_ELEMENTS) {
			const computed = view.getComputedStyle(element, pseudo);
			if (!computed.content || ["none", "normal"].includes(computed.content)) {
				continue;
			}
			const overrides = colorOverrides(computed, toRgba);
			if (!overrides.length) continue;
			let mark = element.getAttribute(PSEUDO_MARK);
			if (!mark) {
				marks += 1;
				mark = String(marks);
				element.setAttribute(PSEUDO_MARK, mark);
			}
			pseudoRules.push(
				`[${PSEUDO_MARK}="${mark}"]${pseudo}{${overrides
					.map(([property, value]) => `${property}:${value} !important`)
					.join(";")}}`,
			);
		}
	}
	const document = root.ownerDocument;
	if (pseudoRules.length && document?.head) {
		const sheet = document.createElement("style");
		sheet.textContent = pseudoRules.join("\n");
		document.head.appendChild(sheet);
	}
};

/**
 * html2canvas can paint content of a lower window over a higher one, so the
 * clone's windows are put in stacking order in the DOM, which is the order it
 * paints in. With `front`, only that window is kept: a window shot shows just
 * the window, nothing that overlapped it.
 */
const layerWindows = (root: Element, view: Window, front?: string): void => {
	const frames = [...root.querySelectorAll<HTMLElement>("[data-memon-window]")];
	const chosen = front ? root.querySelector<HTMLElement>(front) : null;
	if (chosen) {
		for (const frame of frames) {
			if (frame !== chosen) frame.style.setProperty("visibility", "hidden");
		}
		return;
	}
	const depth = (frame: HTMLElement) =>
		Number(view.getComputedStyle(frame).zIndex) || 0;
	for (const frame of frames.sort((a, b) => depth(a) - depth(b))) {
		frame.parentElement?.appendChild(frame);
	}
};

/** A part of the element, in CSS pixels from its top-left corner. */
export interface CaptureCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Marks capture controls (hints, the area picker) so they stay out of it. */
export const CAPTURE_UI_ATTRIBUTE = "data-memon-capture-ui";

/**
 * The element as a PNG, at up to twice the screen's resolution; with a crop,
 * only that part of it.
 */
export const captureElementPng = async (
	element: HTMLElement,
	crop?: CaptureCrop,
	/** The one window to show, e.g. for a window shot. */
	front?: string,
): Promise<Blob> => {
	const scale = Math.min(window.devicePixelRatio || 1, 2);
	let full: HTMLCanvasElement;
	try {
		const { renderElementToCanvas } = await import("./render-dom");
		full = await renderElementToCanvas(element, {
			scale,
			skip: (node) =>
				node.hasAttribute(CAPTURE_UI_ATTRIBUTE) ||
				(front !== undefined &&
					node.hasAttribute("data-memon-window") &&
					!node.matches(front)),
		});
	} catch (error) {
		// The browser's own rendering failed: redraw with html2canvas instead.
		logWarn("[MEMON] Native capture failed, using html2canvas:", error);
		const { default: html2canvas } = await import("html2canvas");
		full = await html2canvas(element, {
			backgroundColor: null,
			logging: false,
			useCORS: true,
			scale,
			ignoreElements: (node) => node.hasAttribute(CAPTURE_UI_ATTRIBUTE),
			onclone: (document, clone) => {
				flattenColors(clone, document.defaultView ?? window);
				layerWindows(clone, document.defaultView ?? window, front);
			},
		});
	}
	let canvas = full;
	if (crop) {
		canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(crop.width * scale));
		canvas.height = Math.max(1, Math.round(crop.height * scale));
		canvas
			.getContext("2d")
			?.drawImage(
				full,
				Math.round(crop.x * scale),
				Math.round(crop.y * scale),
				canvas.width,
				canvas.height,
				0,
				0,
				canvas.width,
				canvas.height,
			);
	}
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("The screenshot is empty.")),
			"image/png",
		),
	);
};

/**
 * Saves a screenshot (of the desktop, a window, or part of the desktop) with
 * the chat's images and returns it as an attachment for the chat composer.
 */
export const captureComputerScreen = async (
	element: HTMLElement,
	crop?: CaptureCrop,
	front?: string,
): Promise<AttachedDocumentRef> => {
	const blob = await captureElementPng(element, crop, front);
	const { documentFileSystemService } = await import(
		"@/services/filesystem/document-filesystem"
	);
	const path = await documentFileSystemService.saveMediaFile(
		new Uint8Array(await blob.arrayBuffer()),
		{ kind: "image", extension: ".png", folder: "inputs" },
	);
	const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
	return {
		path,
		mimeType: "image/png",
		name: `computer-${stamp}.png`,
		docType: "image",
	};
};

/** A dragged rectangle, normalised and clamped to the element's box. */
export const selectionRect = (
	from: { x: number; y: number },
	to: { x: number; y: number },
	bounds: { width: number; height: number },
): CaptureCrop => {
	const clampX = (value: number) => Math.min(Math.max(value, 0), bounds.width);
	const clampY = (value: number) => Math.min(Math.max(value, 0), bounds.height);
	const left = clampX(Math.min(from.x, to.x));
	const top = clampY(Math.min(from.y, to.y));
	return {
		x: left,
		y: top,
		width: clampX(Math.max(from.x, to.x)) - left,
		height: clampY(Math.max(from.y, to.y)) - top,
	};
};
