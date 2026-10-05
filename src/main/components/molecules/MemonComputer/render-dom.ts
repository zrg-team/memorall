/**
 * Draws part of the page the way the browser itself paints it: a clone with
 * every computed style inlined, inside an SVG foreignObject, drawn on a
 * canvas. Unlike a re-implementation of CSS painting, stacking, clipping and
 * modern color functions come out as they are on screen.
 *
 * What an SVG image cannot load is carried over: canvases and images become
 * data URLs, form fields keep their values, fonts are embedded, and scrolled
 * areas keep their scroll position. A frame whose document can be read (the
 * Browser's localhost pages, served through the sandbox) is drawn from that
 * document; other frames and media show as plain boxes.
 */

const XHTML = "http://www.w3.org/1999/xhtml";
/** What a page paints behind everything when it sets no background. */
const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)"]);

const blobToDataUrl = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

/** The window an element belongs to: a framed page's own, not this one. */
const viewOf = (node: Node): Window =>
	node.ownerDocument?.defaultView ?? window;

/**
 * A URL as a data URL, fetched by the window of the document that uses it,
 * so a framed page's resources come from where the page loads them.
 */
const urlToDataUrl = async (
	url: string,
	view: Window = window,
): Promise<string | null> => {
	if (!url || url.startsWith("data:")) return url || null;
	try {
		const response = await view.fetch(url);
		return response.ok ? await blobToDataUrl(await response.blob()) : null;
	} catch {
		return null;
	}
};

/**
 * A loaded image's pixels, without fetching it again; when the canvas will
 * not give them up (another origin), it is fetched instead.
 */
const imageToDataUrl = async (
	image: HTMLImageElement,
): Promise<string | null> => {
	if (image.complete && image.naturalWidth > 0) {
		try {
			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext("2d");
			if (context) {
				context.drawImage(image, 0, 0);
				return canvas.toDataURL();
			}
		} catch {
			// Tainted by another origin: try fetching it below.
		}
	}
	return urlToDataUrl(image.currentSrc || image.src, viewOf(image));
};

/** How long a canvas's page has to draw its next frame. */
const NEXT_FRAME_WAIT_MS = 250;

/**
 * A canvas as its page draws it in the next frame. A WebGL canvas that does
 * not keep its drawing buffer reads blank once its frame is on screen, so
 * between frames it is black. Pages draw in requestAnimationFrame, and a
 * callback asked for now runs after theirs, before the frame is shown: the
 * one moment the picture is there to read. Null when no frame comes.
 */
const drawnDataUrl = (canvas: HTMLCanvasElement): Promise<string | null> =>
	new Promise((resolve) => {
		const view = viewOf(canvas);
		if (typeof view.requestAnimationFrame !== "function") {
			resolve(null);
			return;
		}
		const timer = setTimeout(() => resolve(null), NEXT_FRAME_WAIT_MS);
		view.requestAnimationFrame(() => {
			clearTimeout(timer);
			try {
				resolve(canvas.toDataURL());
			} catch {
				resolve(null);
			}
		});
	});

/** Every computed property, as an inline style. */
const styleText = (computed: CSSStyleDeclaration): string => {
	let css = "";
	for (let index = 0; index < computed.length; index++) {
		const name = computed[index];
		css += `${name}:${computed.getPropertyValue(name)};`;
	}
	return css;
};

/** A box standing in for something an image cannot show. */
const placeholderFor = (computed: CSSStyleDeclaration) => {
	const box = document.createElementNS(XHTML, "div") as HTMLElement;
	box.setAttribute("style", styleText(computed));
	box.style.setProperty("background-color", "rgba(128, 128, 128, 0.12)");
	box.style.setProperty("border", "1px dashed rgba(128, 128, 128, 0.5)");
	return box;
};

/** A frame's document, when this page may read it. */
const readableDocument = (frame: HTMLIFrameElement): Document | null => {
	try {
		const page = frame.contentDocument;
		return page?.documentElement ? page : null;
	} catch {
		return null;
	}
};

/**
 * The color a page paints its whole viewport with: the root's background,
 * or the body's, which the browser carries up to the viewport.
 */
const pageBackground = (page: Document): string | null => {
	for (const element of [page.documentElement, page.body]) {
		if (!element) continue;
		const color = viewOf(element)
			.getComputedStyle(element)
			.getPropertyValue("background-color");
		if (color && !TRANSPARENT.has(color)) return color;
	}
	return null;
};

interface CloneOptions {
	skip: (element: Element) => boolean;
	pending: Promise<void>[];
	/** Framed documents drawn so far: their fonts are embedded too. */
	documents: Document[];
}

/**
 * A readable frame, drawn as a box of the frame's size holding a clone of
 * its page, clipped like the frame clips it.
 */
const cloneFrame = (
	computed: CSSStyleDeclaration,
	page: Document,
	options: CloneOptions,
): HTMLElement => {
	const box = document.createElementNS(XHTML, "div") as HTMLElement;
	box.setAttribute("style", styleText(computed));
	if (computed.display === "inline") box.style.setProperty("display", "block");
	box.style.setProperty("overflow", "hidden");
	// The page's fixed parts (a game's full-screen canvas) sit in its own
	// viewport, the frame. A transform makes the box that viewport; without
	// one they land at the picture's corner and the window shows black.
	if (computed.transform === "none") {
		box.style.setProperty("transform", "translate(0px, 0px)");
	}
	const background = pageBackground(page);
	if (background) box.style.setProperty("background-color", background);
	options.documents.push(page);
	const content = cloneNode(page.documentElement, options);
	if (content) box.appendChild(content);
	return box;
};

const cloneNode = (source: Node, options: CloneOptions): Node | null => {
	if (source.nodeType === Node.TEXT_NODE) return source.cloneNode(false);
	if (source.nodeType !== Node.ELEMENT_NODE) return null;
	const element = source as Element;
	if (options.skip(element)) return null;
	const computed = viewOf(element).getComputedStyle(element);
	if (computed.display === "none") return null;

	const tag = element.tagName.toLowerCase();
	if (tag === "iframe") {
		const page = readableDocument(element as HTMLIFrameElement);
		return page
			? cloneFrame(computed, page, options)
			: placeholderFor(computed);
	}
	if (tag === "video" || tag === "audio" || tag === "object") {
		return placeholderFor(computed);
	}
	if (tag === "canvas") {
		const canvas = element as HTMLCanvasElement;
		const image = document.createElementNS(XHTML, "img") as HTMLImageElement;
		image.setAttribute("style", styleText(computed));
		try {
			image.setAttribute("src", canvas.toDataURL());
		} catch {
			// Tainted by another origin's pixels.
			return placeholderFor(computed);
		}
		options.pending.push(
			drawnDataUrl(canvas).then((data) => {
				if (data) image.setAttribute("src", data);
			}),
		);
		return image;
	}

	// A framed page's root and body become plain boxes inside the frame's.
	const clone =
		tag === "html" || tag === "body"
			? document.createElementNS(XHTML, "div")
			: (element.cloneNode(false) as Element);
	clone.setAttribute("style", styleText(computed));
	clone.removeAttribute("class");
	if (tag === "img") {
		const image = clone as HTMLImageElement;
		image.removeAttribute("srcset");
		options.pending.push(
			imageToDataUrl(element as HTMLImageElement).then((data) => {
				if (data) image.setAttribute("src", data);
				else image.removeAttribute("src");
			}),
		);
	}
	if (tag === "textarea")
		clone.textContent = (element as HTMLTextAreaElement).value;
	if (tag === "input") {
		const input = element as HTMLInputElement;
		clone.setAttribute("value", input.value);
		if (input.checked) clone.setAttribute("checked", "");
	}
	for (const child of element.childNodes) {
		const copy = cloneNode(child, options);
		if (copy) clone.appendChild(copy);
	}
	if (tag === "select") {
		// Mark the copy's option: the page's own select is left alone.
		const index = (element as HTMLSelectElement).selectedIndex;
		clone.querySelectorAll("option")[index]?.setAttribute("selected", "");
	}

	// A scrolled area shows its content from the top unless moved back up.
	const { scrollTop, scrollLeft } = element;
	if ((scrollTop || scrollLeft) && tag !== "textarea") {
		for (const child of clone.children) {
			const style = (child as HTMLElement).style;
			const base = style.getPropertyValue("transform");
			const shift = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
			style.setProperty(
				"transform",
				base && base !== "none" ? `${shift} ${base}` : shift,
			);
		}
	}
	return clone;
};

/** The documents' @font-face rules, with their files embedded. */
const embeddedFonts = async (documents: Document[]): Promise<string> => {
	const rules: Array<{ text: string; base: string; view: Window }> = [];
	for (const page of documents) {
		const view = page.defaultView ?? window;
		for (const sheet of Array.from(page.styleSheets)) {
			let list: CSSRuleList;
			try {
				list = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of Array.from(list)) {
				// By its text: a framed page's rules come from another realm.
				if (rule.cssText.startsWith("@font-face")) {
					rules.push({
						text: rule.cssText,
						base: sheet.href ?? page.baseURI,
						view,
					});
				}
			}
		}
	}
	const urlPattern = /url\((['"]?)([^'")]+)\1\)/g;
	const embedded = await Promise.all(
		rules.map(async ({ text: rule, base, view }) => {
			let text = rule;
			for (const [match, , url] of rule.matchAll(urlPattern)) {
				const data = await urlToDataUrl(new URL(url, base).href, view);
				if (data) text = text.replace(match, `url("${data}")`);
			}
			return text;
		}),
	);
	return embedded.join("\n");
};

/**
 * The element as a self-contained copy: every style inline, readable frames
 * drawn from their pages, images as data URLs once `ready` settles.
 */
export const cloneForCapture = (
	element: HTMLElement,
	skip: (element: Element) => boolean = () => false,
): {
	clone: HTMLElement | null;
	/** Settles once every image is carried over. */
	ready: Promise<void>;
	/** The documents drawn: this page's and every readable frame's. */
	documents: Document[];
} => {
	const pending: Promise<void>[] = [];
	const documents: Document[] = [element.ownerDocument];
	const clone = cloneNode(element, {
		skip,
		pending,
		documents,
	}) as HTMLElement | null;
	return {
		clone,
		ready: Promise.all(pending).then(() => undefined),
		documents,
	};
};

export const renderElementToCanvas = async (
	element: HTMLElement,
	options: { scale: number; skip?: (element: Element) => boolean },
): Promise<HTMLCanvasElement> => {
	const rect = element.getBoundingClientRect();
	const width = Math.ceil(rect.width);
	const height = Math.ceil(rect.height);
	const { clone, ready, documents } = cloneForCapture(element, options.skip);
	if (!clone) throw new Error("Nothing to capture.");
	// The root sits at the image's corner, whatever its place on the page.
	for (const property of [
		"margin",
		"left",
		"top",
		"right",
		"bottom",
		"transform",
	]) {
		clone.style.removeProperty(property);
	}
	clone.style.setProperty("margin", "0");
	clone.style.setProperty("width", `${width}px`);
	clone.style.setProperty("height", `${height}px`);
	await ready;
	const fonts = await embeddedFonts(documents);

	const holder = document.createElementNS(XHTML, "div");
	if (fonts) {
		const style = document.createElementNS(XHTML, "style");
		style.textContent = fonts;
		holder.appendChild(style);
	}
	holder.appendChild(clone);
	const markup = new XMLSerializer().serializeToString(holder);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`;

	const image = new Image();
	image.decoding = "async";
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await image.decode();

	const canvas = document.createElement("canvas");
	canvas.width = Math.round(width * options.scale);
	canvas.height = Math.round(height * options.scale);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("This browser cannot draw the screenshot.");
	context.scale(options.scale, options.scale);
	context.drawImage(image, 0, 0, width, height);
	return canvas;
};
