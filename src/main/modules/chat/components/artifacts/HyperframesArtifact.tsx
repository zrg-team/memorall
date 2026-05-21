import React, { useCallback, useEffect, useRef, useState } from "react";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import type { DocumentTreeNode } from "@/types/document-library";
import type { ArtifactProps } from "./ArtifactActionsMenu";

const IMAGE_MIME_TYPES: Record<string, string> = {
	gif: "image/gif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

const mimeForPath = (path: string): string =>
	IMAGE_MIME_TYPES[path.split(/[?#]/)[0]?.split(".").pop()?.toLowerCase() ?? ""] ??
	"application/octet-stream";

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

const documentPathCandidates = (src: string): string[] => {
	const stripped = src.replace(/^\/documents/, "") || "/";
	return [stripped, src].filter(
		(path, index, paths) => path && paths.indexOf(path) === index,
	);
};

const documentImageToDataUrl = async (src: string): Promise<string | null> => {
	for (const filePath of documentPathCandidates(src)) {
		try {
			return await documentFileSystemService.readFileAsBase64(
				filePath,
				mimeForPath(src),
			);
		} catch {
			// Try the next document path candidate.
		}
	}
	return null;
};

type DocumentImage = {
	name: string;
	path: string;
	mimeType: string;
};

const collectImages = (nodes: DocumentTreeNode[]): DocumentImage[] => {
	const images: DocumentImage[] = [];
	for (const node of nodes) {
		if (node.type === "file" && node.file?.type === "image") {
			images.push({
				name: node.file.name,
				path: node.file.path,
				mimeType: node.file.mimeType || mimeForPath(node.file.path),
			});
		}
		if (node.children.length > 0) {
			images.push(...collectImages(node.children));
		}
	}
	return images;
};

const getDocumentImages = async (): Promise<DocumentImage[]> => {
	const tree = await documentFileSystemService.getTree();
	return collectImages(tree).filter((image) => image.path.startsWith("/images/"));
};

const imageToDataUrl = async (image: DocumentImage): Promise<string | null> => {
	try {
		return await documentFileSystemService.readFileAsBase64(
			image.path,
			image.mimeType || mimeForPath(image.path),
		);
	} catch {
		return null;
	}
};

const recoverDocumentImage = async (
	img: HTMLImageElement,
	getImages: () => Promise<DocumentImage[]>,
): Promise<string | null> => {
	const images = await getImages();
	if (images.length === 0) return null;

	const alt = img.getAttribute("alt")?.toLowerCase() ?? "";
	const className = img.getAttribute("class")?.toLowerCase() ?? "";
	const likelyIcon =
		alt.includes("icon") ||
		className.split(/\s+/).some((name) => name.includes("icon"));

	const iconImages = likelyIcon
		? images.filter((image) =>
				/(^|[-_.])(icon|logo|extension)([-_.]|$)/i.test(image.name),
			)
		: [];
	const candidates = iconImages.length > 0 ? iconImages : images;

	if (candidates.length !== 1) return null;
	return imageToDataUrl(candidates[0]);
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

type NormalizedComposition = { html: string; inlineScripts: string[] };

/**
 * Normalise composition HTML before delivery to the sandbox page.
 *
 * Returns the cleaned HTML (with authored inline scripts removed — they are
 * sent separately so they survive DOMParser round-trips) and the extracted
 * inline animation scripts that must be executed in the preview page.
 */
const normalizeHyperframesHtml = async (html: string): Promise<NormalizedComposition> => {
	const authoredInlineScripts = extractAuthoredInlineScripts(html);
	const doc = new DOMParser().parseFromString(html, "text/html");
	const jobs: Promise<void>[] = [];
	let documentImagesPromise: Promise<DocumentImage[]> | null = null;
	const getImages = (): Promise<DocumentImage[]> =>
		(documentImagesPromise ??= getDocumentImages());

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
		if (!src) {
			jobs.push(
				recoverDocumentImage(img, getImages).then((dataUrl) => {
					if (dataUrl) img.setAttribute("src", dataUrl);
				}),
			);
			continue;
		}

		if (src.startsWith("/documents/")) {
			jobs.push(
				documentImageToDataUrl(src).then((dataUrl) => {
					if (dataUrl) img.setAttribute("src", dataUrl);
				}),
			);
			continue;
		}

		if (src.startsWith("blob:")) {
			jobs.push(
				blobToDataUrl(src)
					.then((dataUrl) => {
						if (dataUrl) img.setAttribute("src", dataUrl);
						else if (isExtensionBlobUrl(src)) {
							return recoverDocumentImage(img, getImages).then((recovered) => {
								if (recovered) img.setAttribute("src", recovered);
							});
						}
					})
					.catch(() => undefined),
			);
		}
	}

	await Promise.all(jobs);
	// Keep inline scripts in the serialised HTML so that the regex-based fallback
	// in the sandbox preview page can still find them if `inlineScripts` is lost.
	// The preview page uses `inlineScripts` as the primary path and falls back to
	// regex extraction from the raw HTML string — both paths need the scripts.
	const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "<!doctype html>";
	return {
		html: `${doctype}\n${doc.documentElement.outerHTML}`,
		inlineScripts: authoredInlineScripts,
	};
};

type HyperframesPlayerElement = HTMLElement & {
	iframeElement?: HTMLIFrameElement;
};

let hyperframesPlayerLoad: Promise<void> | null = null;

const ensureHyperframesPlayer = (): Promise<void> => {
	if (customElements.get("hyperframes-player")) return Promise.resolve();
	hyperframesPlayerLoad ??= new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = chrome.runtime.getURL(
			"vendors/hyperframes/hyperframes-player.global.js",
		);
		script.onload = () => resolve();
		script.onerror = () =>
			reject(new Error("Failed to load HyperFrames player"));
		document.head.appendChild(script);
	});
	return hyperframesPlayerLoad;
};

export const HyperframesArtifact: React.FC<ArtifactProps> = ({
	content,
	title,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	// Use the GitHub Pages runner — no extension CSP applies there, so inline
	// animation scripts execute without restriction. The "/sandbox/" path segment
	// matches the player patch that removes the iframe sandbox attribute and skips
	// contentDocument probing for this URL, keeping cross-origin postMessage as
	// the only communication channel (which works fine).
	const previewUrl =
		"https://zrg-team.github.io/memorall/sandbox/hyperframes-preview.html";
	const [previewHtml, setPreviewHtml] = useState<NormalizedComposition | null>(null);

	// Normalise the composition HTML (inline stale blob scripts, convert images).
	useEffect(() => {
		let cancelled = false;
		setPreviewHtml(null);
		void normalizeHyperframesHtml(content).then((result) => {
			if (!cancelled) setPreviewHtml(result);
		});
		return () => {
			cancelled = true;
		};
	}, [content]);

	// Deliver the composition to the GitHub Pages runner via postMessage.
	//
	// Race-condition handling (no timeouts):
	//   The runner retries sending "ready" every 100 ms until it receives
	//   the composition HTML, so we only need one message listener here — no
	//   manual retry loop required.
	const postComposition = useCallback(
		(player: HyperframesPlayerElement, key: string, composition: NormalizedComposition): void => {
			try {
				player.iframeElement?.contentWindow?.postMessage(
					{
						type: "memorall:hyperframes-composition",
						key,
						html: composition.html,
						inlineScripts: composition.inlineScripts,
					},
					"*",
				);
			} catch {
				// iframe may still be navigating; the preview page's retry will resend.
			}
		},
		[],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !previewHtml) return;

		let cancelled = false;
		let removeMessageListener: (() => void) | null = null;
		const key = `memorall-hyperframes:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
		const compositionUrl = new URL(previewUrl);
		compositionUrl.hash = `composition=${encodeURIComponent(key)}`;
		const composition = previewHtml; // capture non-null for closure

		void ensureHyperframesPlayer().then(() => {
			if (cancelled) return;

			container.textContent = "";
			const player = document.createElement(
				"hyperframes-player",
			) as HyperframesPlayerElement;
			player.setAttribute("controls", "");
			player.setAttribute("autoplay", "");
			player.setAttribute("muted", "");
			player.style.cssText = "display:block;width:100%;height:100%";
			container.appendChild(player);

			// Listen for the "ready" signal from the GitHub Pages runner.
			// The runner re-sends "ready" every 100 ms so there is no race
			// condition — we never miss the signal regardless of load timing.
			const onMessage = (event: MessageEvent): void => {
				if (
					event.data?.type === "memorall:hyperframes-composition-ready" &&
					event.data.key === key
				) {
					postComposition(player, key, composition);
				}
			};
			window.addEventListener("message", onMessage);
			removeMessageListener = () => window.removeEventListener("message", onMessage);

			// Set src last so the listener is in place before the page loads.
			player.setAttribute("src", compositionUrl.href);
		});

		return () => {
			cancelled = true;
			removeMessageListener?.();
			container.textContent = "";
		};
	}, [postComposition, previewHtml, previewUrl]);

	return (
		<div
			ref={containerRef}
			className="my-2 overflow-hidden rounded-md bg-black"
			style={{ display: "block", width: "100%", height: "60vh" }}
			aria-label={title || "HyperFrames composition"}
		/>
	);
};
