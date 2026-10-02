/**
 * Showing files from Files inside an HTML artifact.
 *
 * The preview cannot reach Files by itself: `<img src="/projects/a.jpg">`
 * asks the extension for that path and 404s. So the chat finds every file the
 * page shows, reads it from Files, and hands the frame its bytes with the page
 * (see html-artifact.js). Agents also write names relative to the folder the
 * page is saved in (`photo-00.jpg`); those resolve against the artifact's
 * project folder, or against the full path the same page gives that file
 * elsewhere (a fallback in an `onerror`, say).
 */

import { useEffect, useMemo, useState } from "react";
import { imageMimeFor } from "@/main/modules/files/editors/markdown-assets";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { normalizeSandboxPath } from "@/services/filesystem/sandbox-paths";
import { logWarn } from "@/utils/logger";

const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
};

/** What a relative name has to end in to be looked for in Files. */
const MEDIA_EXTENSION =
	"png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|webm|mov|mp3|wav|ogg|m4a";

/** A path or name as written: no scheme, no protocol-relative `//`. */
const WRITTEN_PATH = String.raw`(?!\/\/)(?![a-z][a-z0-9+.-]*:)[^"'()<>\s?#]+`;

/** `src="…"` and `poster="…"` on any tag. */
const ATTRIBUTE_PATTERN = new RegExp(
	String.raw`(\b(?:src|poster)\s*=\s*)(["'])(${WRITTEN_PATH})([?#][^"']*)?\2`,
	"gi",
);
/** `url(…)` in inline styles and style blocks. */
const CSS_URL_PATTERN = new RegExp(
	String.raw`(url\(\s*)(["']?)(${WRITTEN_PATH})([?#][^"')]*)?\2(\s*\))`,
	"gi",
);
/** Any full path to a media file the page mentions, in markup or script. */
const MENTIONED_PATH_PATTERN = new RegExp(
	String.raw`["'](\/(?!\/)[^"'<>\s?#]+\.(?:${MEDIA_EXTENSION}))["'?#]`,
	"gi",
);
const RELATIVE_MEDIA_PATTERN = new RegExp(
	String.raw`\.(?:${MEDIA_EXTENSION})$`,
	"i",
);

export const assetMimeFor = (path: string): string =>
	MEDIA_MIME_BY_EXTENSION[path.split(".").pop()?.toLowerCase() ?? ""] ??
	imageMimeFor(path);

const decodePath = (path: string): string => {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
};

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const toFilesPath = (path: string): string | null => {
	try {
		return normalizeSandboxPath(decodePath(path));
	} catch {
		return null;
	}
};

/**
 * Each file reference the page shows, as written, with the Files path it
 * means. A relative name is kept only when it can be placed: under the
 * project folder, or where the page itself gives that file's full path.
 */
export const findLocalAssetRefs = (
	html: string,
	projectPath?: string,
): Map<string, string> => {
	const written = new Set<string>();
	for (const match of html.matchAll(ATTRIBUTE_PATTERN)) written.add(match[3]);
	for (const match of html.matchAll(CSS_URL_PATTERN)) written.add(match[3]);

	// File name → the one full path the page gives it (none when ambiguous).
	const mentioned = new Map<string, string | null>();
	for (const match of html.matchAll(MENTIONED_PATH_PATTERN)) {
		const name = baseName(match[1]);
		const seen = mentioned.get(name);
		mentioned.set(
			name,
			seen === undefined || seen === match[1] ? match[1] : null,
		);
	}
	const folder = projectPath?.replace(/\/?$/, "/");

	const refs = new Map<string, string>();
	for (const value of written) {
		let target: string | null | undefined;
		if (value.startsWith("/")) {
			target = value;
		} else if (RELATIVE_MEDIA_PATTERN.test(value)) {
			target = folder
				? `${folder}${value.replace(/^\.\//, "")}`
				: mentioned.get(baseName(value));
		}
		const path = target ? toFilesPath(target) : null;
		if (path) refs.set(value, path);
	}
	// Full paths a script holds (a photo list, a fallback) load as well.
	for (const match of html.matchAll(MENTIONED_PATH_PATTERN)) {
		const path = refs.has(match[1]) ? null : toFilesPath(match[1]);
		if (path) refs.set(match[1], path);
	}
	return refs;
};

/** Swaps each reference written in the page; anything else stays as written. */
export const rewriteLocalAssets = (
	html: string,
	replacements: ReadonlyMap<string, string>,
): string =>
	html
		.replace(ATTRIBUTE_PATTERN, (whole, prefix, quote, value) => {
			const next = replacements.get(value);
			return next ? `${prefix}${quote}${next}${quote}` : whole;
		})
		.replace(CSS_URL_PATTERN, (whole, prefix, quote, value, _query, close) => {
			const next = replacements.get(value);
			return next ? `${prefix}${quote}${next}${quote}${close}` : whole;
		})
		// The page's own fallbacks, in script, to a file it now has.
		.replace(MENTIONED_PATH_PATTERN, (whole, value: string) => {
			const next = replacements.get(value);
			return next ? whole.replace(value, next) : whole;
		});

/** A file the frame turns into a URL of its own, where `token` stands in the page. */
export interface ArtifactAsset {
	token: string;
	bytes: Uint8Array;
	mime: string;
}

export interface PreparedArtifactHtml {
	/** False while files are read, so the preview does not flash broken images. */
	ready: boolean;
	html: string;
	assets: ArtifactAsset[];
	/** Changes whenever the page or its files do: a new frame each time. */
	version: string;
}

/** Trailing slash: token 1 must not be the start of token 10. */
const assetToken = (index: number) => `memorall-asset://${index}/`;

let preparedCount = 0;

/** The page with its Files references swapped for tokens, and their bytes. */
export const usePreparedArtifactHtml = (
	html: string,
	projectPath?: string,
): PreparedArtifactHtml => {
	const refs = useMemo(
		() => findLocalAssetRefs(html, projectPath),
		[html, projectPath],
	);
	const [prepared, setPrepared] = useState<
		(PreparedArtifactHtml & { source: string }) | null
	>(null);

	useEffect(() => {
		if (refs.size === 0) return;
		let cancelled = false;
		void (async () => {
			// One read per file, however many ways the page names it.
			const files = [...new Set(refs.values())];
			const tokens = new Map<string, string>();
			const assets: ArtifactAsset[] = [];
			await Promise.all(
				files.map(async (path, index) => {
					try {
						const bytes = await documentFileSystemService.readMediaFile(
							path,
							1,
						);
						const token = assetToken(index);
						tokens.set(path, token);
						assets.push({ token, bytes, mime: assetMimeFor(path) });
					} catch (error) {
						// Not in Files: the page keeps the reference as written.
						logWarn(`[ARTIFACT] No file at ${path} for the preview:`, error);
					}
				}),
			);
			if (cancelled) return;
			const replacements = new Map<string, string>();
			for (const [written, path] of refs) {
				const token = tokens.get(path);
				if (token) replacements.set(written, token);
			}
			setPrepared({
				source: html,
				ready: true,
				html: rewriteLocalAssets(html, replacements),
				assets,
				version: `files-${++preparedCount}`,
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [html, refs]);

	const plainVersion = useMemo(() => `plain-${++preparedCount}`, [html]);
	if (refs.size === 0) {
		return { ready: true, html, assets: [], version: plainVersion };
	}
	if (prepared?.source === html) {
		const { source: _source, ...rest } = prepared;
		return rest;
	}
	return { ready: false, html, assets: [], version: "" };
};
