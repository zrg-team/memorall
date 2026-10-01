/**
 * Draws part of the page the way the browser itself paints it: a clone with
 * every computed style inlined, inside an SVG foreignObject, drawn on a
 * canvas. Unlike a re-implementation of CSS painting, stacking, clipping and
 * modern color functions come out as they are on screen.
 *
 * What an SVG image cannot load is carried over: canvases and images become
 * data URLs, form fields keep their values, fonts are embedded, and scrolled
 * areas keep their scroll position. Frames and media show as plain boxes.
 */

const XHTML = "http://www.w3.org/1999/xhtml";

const blobToDataUrl = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});

const urlToDataUrl = async (url: string): Promise<string | null> => {
	if (!url || url.startsWith("data:")) return url || null;
	try {
		const response = await fetch(url);
		return response.ok ? await blobToDataUrl(await response.blob()) : null;
	} catch {
		return null;
	}
};

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
const placeholderFor = (source: Element, computed: CSSStyleDeclaration) => {
	const box = document.createElementNS(XHTML, "div") as HTMLElement;
	box.setAttribute("style", styleText(computed));
	box.style.setProperty("background-color", "rgba(128, 128, 128, 0.12)");
	box.style.setProperty("border", "1px dashed rgba(128, 128, 128, 0.5)");
	return box;
};

interface CloneOptions {
	skip: (element: Element) => boolean;
	pending: Promise<void>[];
}

const cloneNode = (source: Node, options: CloneOptions): Node | null => {
	if (source.nodeType === Node.TEXT_NODE) return source.cloneNode(false);
	if (source.nodeType !== Node.ELEMENT_NODE) return null;
	const element = source as Element;
	if (options.skip(element)) return null;
	const computed = getComputedStyle(element);
	if (computed.display === "none") return null;

	const tag = element.tagName.toLowerCase();
	if (
		tag === "iframe" ||
		tag === "video" ||
		tag === "audio" ||
		tag === "object"
	) {
		return placeholderFor(element, computed);
	}
	if (tag === "canvas") {
		const image = document.createElementNS(XHTML, "img") as HTMLImageElement;
		image.setAttribute("style", styleText(computed));
		try {
			image.setAttribute("src", (element as HTMLCanvasElement).toDataURL());
		} catch {
			return placeholderFor(element, computed);
		}
		return image;
	}

	const clone = element.cloneNode(false) as Element;
	clone.setAttribute("style", styleText(computed));
	clone.removeAttribute("class");
	if (tag === "img") {
		const image = clone as HTMLImageElement;
		const src = (element as HTMLImageElement).currentSrc || image.src;
		image.removeAttribute("srcset");
		options.pending.push(
			urlToDataUrl(src).then((data) => {
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

/** The page's @font-face rules, with their files embedded. */
const embeddedFonts = async (): Promise<string> => {
	const rules: string[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		let list: CSSRuleList;
		try {
			list = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of Array.from(list)) {
			if (rule instanceof CSSFontFaceRule) rules.push(rule.cssText);
		}
	}
	const urlPattern = /url\((['"]?)([^'")]+)\1\)/g;
	const embedded = await Promise.all(
		rules.map(async (rule) => {
			let text = rule;
			for (const [match, , url] of rule.matchAll(urlPattern)) {
				const data = await urlToDataUrl(new URL(url, document.baseURI).href);
				if (data) text = text.replace(match, `url("${data}")`);
			}
			return text;
		}),
	);
	return embedded.join("\n");
};

export const renderElementToCanvas = async (
	element: HTMLElement,
	options: { scale: number; skip?: (element: Element) => boolean },
): Promise<HTMLCanvasElement> => {
	const rect = element.getBoundingClientRect();
	const width = Math.ceil(rect.width);
	const height = Math.ceil(rect.height);
	const pending: Promise<void>[] = [];
	const clone = cloneNode(element, {
		skip: options.skip ?? (() => false),
		pending,
	}) as HTMLElement | null;
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
	await Promise.all(pending);
	const fonts = await embeddedFonts();

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
