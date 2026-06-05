import type { IFlowFileSystem } from "flow-core/interfaces/services/filesystem";

// ── Configurable document roots ───────────────────────────────────────────────

let _documentRoots: string[] = [];

/**
 * Configure which virtual path prefixes count as "local document" roots whose
 * image `src` attributes should be rewritten to data URLs before the
 * composition is rendered in an iframe.
 *
 * Call this during host app initialisation:
 *   setCompositionDocumentRoots(["/documents"])
 *
 * When empty (the default), no image rewriting is performed.
 */
export function setCompositionDocumentRoots(roots: string[]): void {
	_documentRoots = roots.map((r) => r.replace(/\/+$/, ""));
}

// ── Local image → data URL ────────────────────────────────────────────────────
// Images referenced as src="<documentRoot>/..." can't load inside the player
// iframe because those paths aren't real URLs. Read each file from the FS and
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

const fsPathCandidates = (docPath: string, root: string): string[] => {
	const stripped = docPath.startsWith(root)
		? docPath.slice(root.length) || "/"
		: docPath;
	return [stripped, docPath].filter(
		(path, index, paths) => path && paths.indexOf(path) === index,
	);
};

const buildLocalImagePattern = (): RegExp | null => {
	if (_documentRoots.length === 0) return null;
	const escaped = _documentRoots.map((r) =>
		r.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"),
	);
	return new RegExp(`\\bsrc=(["'])((?:${escaped.join("|")})/[^"']+)\\1`, "gi");
};

const injectLocalImages = async (
	html: string,
	dfs: IFlowFileSystem,
): Promise<string> => {
	const pattern = buildLocalImagePattern();
	if (!pattern) return html;

	const matches = [...html.matchAll(pattern)];
	if (matches.length === 0) return html;

	let result = html;
	for (const [full, , docPath] of matches) {
		const matchingRoot =
			_documentRoots.find(
				(r) => docPath === r || docPath.startsWith(`${r}/`),
			) ?? "";

		for (const fsPath of fsPathCandidates(docPath, matchingRoot)) {
			try {
				const bytes = await dfs.readFile(fsPath);
				const dataUrl = `data:${mimeFor(docPath)};base64,${toBase64(bytes)}`;
				result = result.replace(full, `src="${dataUrl}"`);
				break;
			} catch {
				// Try the next candidate.
			}
		}
	}
	return result;
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Preprocess a HyperFrames composition HTML for safe rendering inside an
 * iframe:
 *
 * 1. Local image src paths (under configured document roots) → data URLs.
 *    Fixes: local document images don't load as bare paths in the iframe.
 *
 * Configure document roots with setCompositionDocumentRoots before use.
 * Inline scripts are left as-is.
 */
export const preprocessComposition = async (
	html: string,
	dfs: IFlowFileSystem,
): Promise<string> => {
	return injectLocalImages(html, dfs);
};
