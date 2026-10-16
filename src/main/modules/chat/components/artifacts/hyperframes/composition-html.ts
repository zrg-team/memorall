import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	toWorkspacesSandboxPath,
	toDocumentsSandboxPath,
	isDocumentsSandboxPath,
	isWorkspacesSandboxPath,
	DOCUMENTS_SANDBOX_ROOT,
	WORKSPACES_SANDBOX_ROOT,
} from "@/services/filesystem/sandbox-paths";
import {
	FILESYSTEM_SCOPE,
	type FilesystemScope,
} from "@/services/filesystem/filesystem-paths";
import type { DocumentTreeNode } from "@/types/document-library";
import {
	bundledFontFaces,
	type CatalogFontLoader,
	type CatalogFontManifest,
	HYPERFRAMES_FONT_ASSET_DIR,
} from "@/services/flows-integrations/tools/hyperframes/fonts";
import { platform } from "@/platform/current";

const fontAsset = (file: string) =>
	platform.assets.url(`${HYPERFRAMES_FONT_ASSET_DIR}/${file}`);

let fontManifest: Promise<CatalogFontManifest> | null = null;
const fontFiles = new Map<string, Promise<Uint8Array>>();

const fetchBytes = async (url: string): Promise<Uint8Array> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not load ${url}`);
	return new Uint8Array(await response.arrayBuffer());
};

/** The packaged design-preset fonts, fetched once per page. */
const catalogFonts: CatalogFontLoader = {
	manifest: () => {
		fontManifest ??= fetch(fontAsset("manifest.json"))
			.then((response) => (response.ok ? response.json() : {}))
			.catch(() => {
				fontManifest = null;
				return {};
			});
		return fontManifest;
	},
	file: (file) => {
		let bytes = fontFiles.get(file);
		if (!bytes) {
			bytes = fetchBytes(fontAsset(file)).catch((error) => {
				fontFiles.delete(file);
				throw error;
			});
			fontFiles.set(file, bytes);
		}
		return bytes;
	},
};

// All resolved candidates carry a full root filesystem path.
// readFile accepts both directly — no stripping or re-prefixing needed.
type ImageReferenceCandidate = {
	path: string; // full sandbox path
	mimeType: string;
};

// Fuzzy-match result from the document tree. path is a logical path (no scope prefix).
type FilesystemImageReference = {
	scope: FilesystemScope;
	name: string;
	path: string;
	mimeType: string;
};

export const safeFilenameBase = (value?: string): string => {
	const cleaned = (value?.trim() || "hyperframes-composition")
		.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
	return cleaned || "hyperframes-composition";
};

const blobToDataUrl = async (url: string): Promise<string | null> => {
	try {
		const response = await fetch(url);
		if (!response.ok) return null;
		const blob = await response.blob();
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
};

const isExtensionBlobUrl = (value: string): boolean =>
	value.startsWith("blob:chrome-extension://");

const bytesToDataUrl = (bytes: Uint8Array, mimeType: string): string => {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return `data:${mimeType};base64,${btoa(binary)}`;
};

const imageMimeType = (path: string): string => {
	const ext = path.split(/[?#]/)[0]?.toLowerCase().split(".").pop();
	switch (ext) {
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "svg":
			return "image/svg+xml";
		case "ico":
			return "image/x-icon";
		case "png":
		default:
			return "image/png";
	}
};

const isExternalOrEmbeddedReference = (value: string): boolean =>
	/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);

const isLikelyImagePath = (value: string): boolean =>
	/\.(?:png|jpe?g|gif|webp|svg|ico)(?:[?#].*)?$/i.test(value);

const imageBasename = (value: string): string => {
	const clean = value.split(/[?#]/)[0]?.replace(/\\/g, "/") ?? "";
	const name = clean.split("/").filter(Boolean).pop() ?? clean;
	try {
		return decodeURIComponent(name).toLowerCase();
	} catch {
		return name.toLowerCase();
	}
};

const normalizeImageLookupPath = (value: string): string => {
	const clean = value.split(/[?#]/)[0]?.replace(/\\/g, "/") ?? "";
	const segments = clean
		.split("/")
		.filter((segment) => segment && segment !== ".");
	return segments.join("/").toLowerCase();
};

// Build full sandbox path candidates for an image src.
// All returned paths are normalized root filesystem paths so readFile
// can accept them directly without any further transformation.
const imageReferenceCandidates = (
	src: string,
	projectPath?: string,
): ImageReferenceCandidate[] => {
	const path = src.split(/[?#]/)[0]?.replace(/\\/g, "/") ?? src;
	if (!path) return [];

	const mimeType = imageMimeType(path);

	// Already a sandbox path — use as-is
	if (isDocumentsSandboxPath(path) || isWorkspacesSandboxPath(path)) {
		return [{ path, mimeType }];
	}

	// Absolute non-sandbox path — default to documents scope
	if (path.startsWith("/")) {
		return [{ path: toDocumentsSandboxPath(path), mimeType }];
	}

	// Relative path — resolve against projectPath (which may be a workspace or
	// documents path). Convert to sandbox once here so readFile gets a valid path.
	if (projectPath) {
		const base = projectPath.replace(/\/+$/, "");
		const sandboxBase = isWorkspacesSandboxPath(base)
			? base
			: toDocumentsSandboxPath(base);
		const cleanRef = path.replace(/^\.\/+/, "");
		const filename = cleanRef.split("/").pop();
		const candidates: ImageReferenceCandidate[] = [
			{ path: `${sandboxBase}/${cleanRef}`, mimeType },
		];
		if (!cleanRef.startsWith("resources/")) {
			candidates.push({
				path: `${sandboxBase}/resources/${cleanRef}`,
				mimeType,
			});
			if (filename) {
				candidates.push({
					path: `${sandboxBase}/resources/images/${filename}`,
					mimeType,
				});
			}
		}
		return candidates;
	}

	return [];
};

// Single read path: candidate.path is always a full sandbox path.
const readImageReferenceCandidate = async (
	candidate: ImageReferenceCandidate,
): Promise<string | null> => {
	try {
		const bytes = await documentFileSystemService.readFile(candidate.path);
		return bytesToDataUrl(bytes, candidate.mimeType);
	} catch {
		return null;
	}
};

const collectImageReferences = (
	nodes: DocumentTreeNode[],
	scope: FilesystemScope,
): FilesystemImageReference[] => {
	const images: FilesystemImageReference[] = [];
	for (const node of nodes) {
		const file = node.type === "file" ? node.file : null;
		if (file && (file.type === "image" || isLikelyImagePath(file.path))) {
			images.push({
				scope,
				name: file.name,
				path: file.path,
				mimeType: file.mimeType || imageMimeType(file.path),
			});
		}
		if (node.children.length > 0) {
			images.push(...collectImageReferences(node.children, scope));
		}
	}
	return images;
};

const findImageReferenceByRelativePath = async (
	src: string,
): Promise<FilesystemImageReference | null> => {
	const [documentTree, workspaceTree] = await Promise.all([
		documentFileSystemService.getTree(DOCUMENTS_SANDBOX_ROOT),
		documentFileSystemService.getTree(WORKSPACES_SANDBOX_ROOT),
	]);
	const images = [
		...collectImageReferences(documentTree, FILESYSTEM_SCOPE.DOCUMENTS),
		...collectImageReferences(workspaceTree, FILESYSTEM_SCOPE.WORKSPACE),
	];
	const srcName = imageBasename(src);
	const normalizedSrc = normalizeImageLookupPath(src);
	const matches = images.filter((image) => {
		const imagePath = normalizeImageLookupPath(image.path);
		return (
			image.name.toLowerCase() === srcName ||
			imagePath === normalizedSrc ||
			imagePath.endsWith(`/${normalizedSrc}`)
		);
	});

	return matches.length === 1 ? matches[0] : null;
};

const resolveImageReference = async (
	src: string,
	projectPath?: string,
): Promise<string | null> => {
	if (isExternalOrEmbeddedReference(src) || !isLikelyImagePath(src)) {
		return null;
	}

	for (const candidate of imageReferenceCandidates(src, projectPath)) {
		const dataUrl = await readImageReferenceCandidate(candidate);
		if (dataUrl) return dataUrl;
	}

	if (src.startsWith("/")) return null;

	const image = await findImageReferenceByRelativePath(src);
	if (!image) return null;

	// Tree paths are logical (no scope prefix) — convert to sandbox before readFile
	const sandboxPath =
		image.scope === FILESYSTEM_SCOPE.WORKSPACE
			? toWorkspacesSandboxPath(image.path)
			: toDocumentsSandboxPath(image.path);
	return readImageReferenceCandidate({
		path: sandboxPath,
		mimeType: image.mimeType,
	});
};

const replaceCssImageUrls = async (
	css: string,
	projectPath?: string,
): Promise<string> => {
	const URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
	const matches = Array.from(css.matchAll(URL_PATTERN));
	if (matches.length === 0) return css;

	let next = css;
	for (const match of matches) {
		const full = match[0];
		const src = match[2]?.trim();
		if (!src) continue;

		const dataUrl = await resolveImageReference(src, projectPath);
		if (!dataUrl) continue;
		next = next.replace(full, `url("${dataUrl}")`);
	}
	return next;
};

const replaceImageAttribute = async (
	el: Element,
	attributeName: string,
	projectPath?: string,
): Promise<void> => {
	const src = el.getAttribute(attributeName);
	if (!src) return;

	const dataUrl = await resolveImageReference(src, projectPath);
	if (dataUrl) el.setAttribute(attributeName, dataUrl);
};

const AUTHORED_HYPERFRAMES_SCRIPT_PATTERN =
	/(?:window\.__timelines|__timelines\s*=|gsap\.timeline|HyperShader\.init)/;

const extractAuthoredInlineScripts = (html: string): string[] => {
	const scripts: string[] = [];
	const inlineScriptPattern =
		/<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
	for (const match of html.matchAll(inlineScriptPattern)) {
		const code = match[2]?.trim();
		if (code && AUTHORED_HYPERFRAMES_SCRIPT_PATTERN.test(code)) {
			scripts.push(code);
		}
	}
	return scripts;
};

export type NormalizedComposition = { html: string; inlineScripts: string[] };

/**
 * Normalise composition HTML before delivery to the sandbox page.
 *
 * Returns the cleaned HTML (with authored inline scripts removed — they are
 * sent separately so they survive DOMParser round-trips) and the extracted
 * inline animation scripts that must be executed in the preview page.
 */
export const normalizeHyperframesHtml = async (
	html: string,
	projectPath?: string,
): Promise<NormalizedComposition> => {
	const authoredInlineScripts = extractAuthoredInlineScripts(html);
	const doc = new DOMParser().parseFromString(html, "text/html");
	const jobs: Promise<void>[] = [];

	for (const script of Array.from(
		doc.querySelectorAll<HTMLScriptElement>("script[src^='blob:']"),
	)) {
		const src = script.getAttribute("src");
		if (!src) continue;
		jobs.push(
			fetch(src)
				.then((response) => (response.ok ? response.text() : null))
				.then((code) => {
					if (!code) return;
					script.removeAttribute("src");
					script.textContent = code;
				})
				.catch(() => {
					// Stale extension blob URLs cannot be loaded cross-context.
					// Always remove them — the authored inline script is re-appended below.
					if (isExtensionBlobUrl(src)) {
						script.remove();
					}
				}),
		);
	}

	for (const img of Array.from(doc.querySelectorAll<HTMLImageElement>("img"))) {
		const src = img.getAttribute("src");
		if (!src) continue;

		if (src.startsWith("blob:")) {
			jobs.push(
				blobToDataUrl(src)
					.then((dataUrl) => {
						if (dataUrl) img.setAttribute("src", dataUrl);
						else if (isExtensionBlobUrl(src)) {
							return resolveImageReference(src, projectPath).then(
								(recovered) => {
									if (recovered) img.setAttribute("src", recovered);
								},
							);
						}
					})
					.catch(() => undefined),
			);
		}

		jobs.push(
			resolveImageReference(src, projectPath).then((dataUrl) => {
				if (dataUrl) img.setAttribute("src", dataUrl);
			}),
		);
	}

	for (const svgImage of Array.from(doc.querySelectorAll("image"))) {
		jobs.push(replaceImageAttribute(svgImage, "href", projectPath));
		jobs.push(replaceImageAttribute(svgImage, "xlink:href", projectPath));
	}

	for (const video of Array.from(doc.querySelectorAll("video[poster]"))) {
		jobs.push(replaceImageAttribute(video, "poster", projectPath));
	}

	for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[style]"))) {
		const style = el.getAttribute("style");
		if (!style || !/url\(/i.test(style)) continue;
		jobs.push(
			replaceCssImageUrls(style, projectPath).then((nextStyle) => {
				if (nextStyle !== style) el.setAttribute("style", nextStyle);
			}),
		);
	}

	for (const styleEl of Array.from(
		doc.querySelectorAll<HTMLStyleElement>("style"),
	)) {
		const css = styleEl.textContent ?? "";
		if (!/url\(/i.test(css)) continue;
		jobs.push(
			replaceCssImageUrls(css, projectPath).then((nextCss) => {
				if (nextCss !== css) styleEl.textContent = nextCss;
			}),
		);
	}

	jobs.push(
		bundledFontFaces(html, catalogFonts)
			.then((rules) => {
				if (!rules) return;
				const style = doc.createElement("style");
				style.setAttribute("data-hf-bundled-fonts", "");
				style.textContent = rules;
				// First: an @font-face the composition declares itself wins.
				doc.head.prepend(style);
			})
			.catch(() => undefined),
	);

	await Promise.all(jobs);
	// Keep inline scripts in the serialised HTML so that the regex-based fallback
	// in the sandbox preview page can still find them if `inlineScripts` is lost.
	// The preview page uses `inlineScripts` as the primary path and falls back to
	// regex extraction from the raw HTML string — both paths need the scripts.
	const doctype = doc.doctype
		? `<!doctype ${doc.doctype.name}>`
		: "<!doctype html>";
	return {
		html: `${doctype}\n${doc.documentElement.outerHTML}`,
		inlineScripts: authoredInlineScripts,
	};
};
