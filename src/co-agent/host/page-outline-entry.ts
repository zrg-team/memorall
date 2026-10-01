import {
	actOnRef,
	buildPageOutline,
	type PageOutline,
	type PageOutlineActionRequest,
	type PageOutlineActionResult,
} from "@/co-agent/dom/page-outline";

/**
 * The page outline, bundled for injection into pages in the desktop managed
 * browser (CDP and BrowserOS evaluate it on demand).
 *
 * Built by `tools/prepare-desktop-browser-runtime.mjs` into one classic script,
 * like the co-agent bundle, so the desktop reads pages with exactly the code
 * the extension content script runs. It may import only `@/co-agent/dom`.
 */

interface PageOutlineApi {
	build(maxChars: number): PageOutline;
	act(
		request: PageOutlineActionRequest,
		maxChars: number,
	): Promise<{ result: PageOutlineActionResult; outline: PageOutline }>;
}

declare global {
	interface Window {
		__memorallPageOutline?: PageOutlineApi;
	}
}

if (!window.__memorallPageOutline) {
	window.__memorallPageOutline = {
		build: (maxChars) => buildPageOutline(document, { maxChars }),
		act: async (request, maxChars) => {
			const result = actOnRef(document, request);
			await new Promise((resolve) => window.setTimeout(resolve, 120));
			return { result, outline: buildPageOutline(document, { maxChars }) };
		},
	};
}
