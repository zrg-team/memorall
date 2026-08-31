/**
 * Resolving image/asset references written inside a markdown document.
 *
 * A markdown file in the library is rendered by an extension page, so a
 * relative `![](banner.webp)` would resolve against the extension origin and
 * 404. These helpers turn such a reference back into a path in the shared
 * document filesystem, which the preview then reads and shows as a blob URL.
 */

import { normalizeSandboxPath } from "@/services/filesystem/sandbox-paths";

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
	bmp: "image/bmp",
	ico: "image/x-icon",
};

export const imageMimeFor = (path: string): string =>
	IMAGE_MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""] ??
	"application/octet-stream";

/** True for sources the browser can already fetch on its own. */
export const isDirectlyLoadable = (src: string): boolean =>
	/^(https?:|data:|blob:|chrome-extension:|moz-extension:|file:)/i.test(src);

/**
 * Resolve an asset path written in the markdown against the folder the file
 * lives in, the way a renderer sitting next to the file would. Returns a path
 * in the document filesystem, or null when the reference is unusable.
 */
export const resolveMarkdownAssetPath = (
	filePath: string,
	src: string,
): string | null => {
	const cleaned = src.split(/[?#]/)[0].trim();
	if (!cleaned) return null;
	let decoded = cleaned;
	try {
		decoded = decodeURIComponent(cleaned);
	} catch {
		// A stray percent sign is not a reason to drop the image.
	}
	const directory = filePath.replace(/[^/]*$/, "");
	try {
		return normalizeSandboxPath(
			decoded.startsWith("/") ? decoded : `${directory}${decoded}`,
		);
	} catch {
		return null;
	}
};
