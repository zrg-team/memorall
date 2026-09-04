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
