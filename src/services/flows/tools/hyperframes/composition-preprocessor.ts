import type { DocumentFileSystem } from "@/services/filesystem/document-filesystem";

// ── CDN → local extension URL ─────────────────────────────────────────────────
// All HyperFrames CDN scripts are bundled locally under vendors/hyperframes/
// (copied by tools/copy-bundled-assets.mjs) and served from the extension's own
// origin — covered by `script-src 'self'` without any manifest CSP additions.

const CDN_TO_LOCAL: Record<string, string> = {
	"https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js":
		"vendors/hyperframes/gsap.min.js",
	"https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js":
		"vendors/hyperframes/hyperframe.runtime.iife.js",
	"https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js":
		"vendors/hyperframes/shader-transitions.global.js",
	// html2canvas injected by withCaptureScript in capture/export tools
	"https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js":
		"vendors/hyperframes/html2canvas.min.js",
};

const rewriteCdnToLocal = (html: string): string => {
	let result = html;
	for (const [cdn, local] of Object.entries(CDN_TO_LOCAL)) {
		const localUrl = chrome.runtime.getURL(local);
		result = result.replaceAll(cdn, localUrl);
	}
	return result;
};

// ── Inline script → blob URL ──────────────────────────────────────────────────
// Extension pages cannot execute inline scripts. This helper is kept for
// non-extension contexts, but preview rendering should use the declared
// sandbox page instead of blob scripts because extension CSP blocks them.

const inlineScriptsToBlobUrls = (html: string): string =>
	html.replace(
		// Match <script> without a src= attribute (i.e. inline scripts)
		/<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi,
		(_, attrs: string, body: string) => {
			const code = body.trim();
			if (!code) return `<script${attrs}></script>`;
			const blobUrl = URL.createObjectURL(
				new Blob([code], { type: "application/javascript" }),
			);
			return `<script${attrs} src="${blobUrl}"></script>`;
		},
	);

// ── Local image → data URL ────────────────────────────────────────────────────
// Images referenced as src="/documents/..." can't load inside the player iframe
// because the /documents/ path isn't a real URL. Read the file from FS and
// replace it with a data URL that survives across frames and execution contexts.

const EXT_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
};

const mimeFor = (path: string): string =>
	EXT_MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
};

const documentPathCandidates = (docPath: string): string[] => {
	const stripped = docPath.replace(/^\/documents/, "") || "/";
	return [
		stripped,
		docPath,
	].filter((path, index, paths) => path && paths.indexOf(path) === index);
};

const injectLocalImages = async (
	html: string,
	dfs: DocumentFileSystem,
): Promise<string> => {
	// Match src="..." or src='...' where the path starts with /documents/
	const PATTERN = /\bsrc=(["'])(\/documents\/[^"']+)\1/gi;
	const matches = [...html.matchAll(PATTERN)];
	if (matches.length === 0) return html;

	let result = html;
	for (const [full, , docPath] of matches) {
		for (const fsPath of documentPathCandidates(docPath)) {
			try {
				const bytes = await dfs.getFileContent(fsPath);
				const dataUrl = `data:${mimeFor(docPath)};base64,${toBase64(bytes)}`;
				result = result.replace(full, `src="${dataUrl}"`);
				break;
			} catch {
				// Try the next document path candidate.
			}
		}
	}
	return result;
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Preprocess a HyperFrames composition HTML for safe rendering inside the
 * browser extension:
 *
 * 1. CDN script URLs → local extension URLs (chrome.runtime.getURL).
 *    Fixes: CSP blocks external CDN; local copies covered by `'self'`.
 *
 * 2. `/documents/...` image src paths → data URLs.
 *    Fixes: local document images don't load as bare paths in the iframe.
 *
 * Inline scripts are left as-is. Extension preview rendering must run in the
 * manifest-declared sandbox page so generated animation code is not blocked by
 * extension-page CSP.
 */
export const preprocessComposition = async (
	html: string,
	dfs: DocumentFileSystem,
	options: { convertInlineScripts?: boolean } = {},
): Promise<string> => {
	let processed = rewriteCdnToLocal(html);
	if (options.convertInlineScripts) {
		processed = inlineScriptsToBlobUrls(processed);
	}
	processed = await injectLocalImages(processed, dfs);
	return processed;
};
