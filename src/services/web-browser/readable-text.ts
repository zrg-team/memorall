/**
 * Readable-text extraction shared by every web snapshot path (the content
 * script, the offscreen registry's iframe sessions and its DOMParser fallback).
 *
 * Besides scripts and styles, children of void elements are dropped. Void
 * elements cannot have children in parsed HTML, but a page's scripts can still
 * append nodes to them in the live DOM: batdongsan.com.vn's image slider hangs
 * the raw JPEG bytes of each photo as a text node under its `<img>`. `outerHTML`
 * never serialises void-element children, so the HTML looked fine, while
 * `innerText`/`textContent` happily included them and a 350K-char page produced
 * a 4M-char snapshot of binary garbage that was then shipped through every
 * messaging hop and re-captured on every render-stability poll.
 */

export const NON_READABLE_SELECTOR = "script, style, noscript, link, template";

export const VOID_ELEMENT_SELECTOR =
	"area, base, br, col, embed, hr, img, input, meta, param, source, track, wbr";

export const removeNonReadableNodes = (root: ParentNode): void => {
	root.querySelectorAll(NON_READABLE_SELECTOR).forEach((node) => {
		node.remove();
	});
	root.querySelectorAll(VOID_ELEMENT_SELECTOR).forEach((node) => {
		if (node.hasChildNodes()) {
			node.textContent = "";
		}
	});
};

/**
 * Text of `document` with non-readable nodes removed. Works on a deep clone so
 * the live page is never mutated.
 */
export const extractReadableDocumentText = (document: Document): string => {
	const clonedDocument = document.cloneNode(true) as Document;
	removeNonReadableNodes(clonedDocument);
	return (
		clonedDocument.body?.innerText ||
		clonedDocument.documentElement?.textContent ||
		""
	).trim();
};

/**
 * Per-element text budget for a DOM query.
 *
 * A query returns tens of elements and every one carries its text, so the cap is
 * per element and deliberately small: enough to recognise a node, never enough
 * to ship a page through it. `web_read` is the tool for content.
 */
export const MAX_ELEMENT_TEXT_CHARS = 2_000;

const VOID_ELEMENT_TAGS = new Set(
	VOID_ELEMENT_SELECTOR.split(",").map((tag) => tag.trim().toLowerCase()),
);

export const isVoidElement = (element: Element): boolean =>
	VOID_ELEMENT_TAGS.has(element.tagName.toLowerCase());

/**
 * The readable text of one element, with the page's own byte-stuffing removed.
 *
 * A void element yields nothing at all: it has no legitimate text, and the one
 * thing that ever appears under it is what a page's own script put there —
 * batdongsan.com.vn hangs the raw JPEG bytes of every photo under its `<img>`,
 * so a query for `img` returned thirty images as "text" and blew a
 * one-million-token context window on binary garbage.
 *
 * For everything else, scripts and styles are dropped (a query for `div`
 * otherwise returns whatever bundle sits inside it), runs of whitespace collapse
 * so the budget buys words rather than indentation, and the result is capped.
 */
export const extractElementText = (element: Element): string => {
	if (isVoidElement(element)) return "";

	let source = element;
	if (
		element.querySelector(`${NON_READABLE_SELECTOR}, ${VOID_ELEMENT_SELECTOR}`)
	) {
		// Clone before pruning: the page is the user's, not ours to edit.
		const clone = element.cloneNode(true) as Element;
		removeNonReadableNodes(clone);
		source = clone;
	}

	const text = (source.textContent ?? "").replace(/\s+/g, " ").trim();
	return text.length > MAX_ELEMENT_TEXT_CHARS
		? `${text.slice(0, MAX_ELEMENT_TEXT_CHARS)}…[truncated]`
		: text;
};

/**
 * An element's media source, safe to put in a tool result.
 *
 * A `data:` URL *is* the image — often megabytes of base64 — so carrying it
 * would reintroduce through `src` exactly the flood that `extractElementText`
 * just stopped. Summarise those instead: the agent learns the picture is inline
 * and how big it is, which is all it can act on, since there is nothing to
 * re-fetch.
 */
export const extractElementSource = (element: Element): string | null => {
	const raw =
		element.getAttribute("src") ??
		element.getAttribute("data-src") ??
		element.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ??
		null;
	if (!raw) return null;

	if (raw.startsWith("data:")) {
		const mime = raw.slice(5, raw.indexOf(";") >= 0 ? raw.indexOf(";") : 5);
		const kb = Math.round(raw.length / 1024);
		return `data:${mime || "unknown"} (inline, ~${kb} KB — not fetchable)`;
	}
	return raw;
};
