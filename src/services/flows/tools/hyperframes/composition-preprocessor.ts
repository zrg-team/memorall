import type { IFlowFileSystem } from "../../interfaces/filesystem";

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
	EXT_MIME[path.split(".").pop()?.toLowerCase() ?? ""] ??
	"application/octet-stream";

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
	return [stripped, docPath].filter(
		(path, index, paths) => path && paths.indexOf(path) === index,
	);
};

const injectLocalImages = async (
	html: string,
	dfs: IFlowFileSystem,
): Promise<string> => {
	// Match src="..." or src='...' where the path starts with /documents/
	const PATTERN = /\bsrc=(["'])(\/documents\/[^"']+)\1/gi;
	const matches = [...html.matchAll(PATTERN)];
	if (matches.length === 0) return html;

	let result = html;
	for (const [full, , docPath] of matches) {
		for (const fsPath of documentPathCandidates(docPath)) {
			try {
				const bytes = await dfs.readFile(fsPath);
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
	dfs: IFlowFileSystem,
): Promise<string> => {
	const processed = await injectLocalImages(html, dfs);
	return processed;
};
