import React, { useCallback, useEffect, useRef, useState } from "react";
import {
	AlertTriangle,
	Download,
	Loader2,
	Send,
	SlidersHorizontal,
	X,
} from "lucide-react";
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
import type { ArtifactProps } from "./ArtifactActionsMenu";

// All resolved candidates carry a full sandbox path (/documents/... or /workspaces/...).
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

const safeFilenameBase = (value?: string): string => {
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
// All returned paths start with /documents/... or /workspaces/... so readFile
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

type NormalizedComposition = { html: string; inlineScripts: string[] };

/**
 * Normalise composition HTML before delivery to the sandbox page.
 *
 * Returns the cleaned HTML (with authored inline scripts removed — they are
 * sent separately so they survive DOMParser round-trips) and the extracted
 * inline animation scripts that must be executed in the preview page.
 */
const normalizeHyperframesHtml = async (
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

type HyperframesPlayerElement = HTMLElement & {
	iframeElement?: HTMLIFrameElement;
};

type ExportPhase = "idle" | "preparing" | "exporting" | "complete" | "failed";

type ExportState = {
	phase: ExportPhase;
	frame?: number;
	total?: number;
	error?: string;
};

type ExportFps = 24 | 25 | 30;
type ExportQuality = "standard" | "high" | "max";
type ExportSize = "native" | "720p" | "1080p" | "1440p" | "2160p";

type ExportSettings = {
	fps: ExportFps;
	quality: ExportQuality;
	size: ExportSize;
};

type PendingDownload = {
	url: string;
	filename: string;
};

type PreviewIssue = {
	kind: string;
	message: string;
	details?: Record<string, unknown>;
};

const MAX_PREVIEW_ISSUES = 8;
const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	fps: 30,
	quality: "max",
	size: "native",
};
const EXPORT_FPS_OPTIONS: ExportFps[] = [24, 25, 30];
const EXPORT_QUALITY_OPTIONS: { value: ExportQuality; label: string }[] = [
	{ value: "max", label: "Max" },
	{ value: "high", label: "High" },
	{ value: "standard", label: "Standard" },
];
const EXPORT_SIZE_OPTIONS: { value: ExportSize; label: string }[] = [
	{ value: "native", label: "Native" },
	{ value: "720p", label: "720p" },
	{ value: "1080p", label: "1080p" },
	{ value: "1440p", label: "1440p" },
	{ value: "2160p", label: "2160p" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

const toPreviewIssue = (value: unknown): PreviewIssue | null => {
	if (!isRecord(value)) return null;
	const message = typeof value.message === "string" ? value.message : "";
	if (!message.trim()) return null;
	return {
		kind: typeof value.kind === "string" ? value.kind : "runtime",
		message,
		details: isRecord(value.details) ? value.details : undefined,
	};
};

const formatPreviewIssue = (issue: PreviewIssue): string => {
	const source =
		typeof issue.details?.source === "string" ? issue.details.source : "";
	const line =
		typeof issue.details?.line === "number" ? `:${issue.details.line}` : "";
	const location = source ? ` (${source}${line})` : "";
	return `[${issue.kind}] ${issue.message}${location}`;
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
	identifier,
	title,
	projectPath,
	onMessageAction,
}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<HyperframesPlayerElement | null>(null);
	const compositionKeyRef = useRef<string | null>(null);
	const filenameBaseRef = useRef<string>("hyperframes-composition");
	const pendingDownloadRef = useRef<PendingDownload | null>(null);
	// Use the GitHub Pages runner — no extension CSP applies there, so inline
	// animation scripts execute without restriction. The "/sandbox/" path segment
	// matches the player patch that removes the iframe sandbox attribute and skips
	// contentDocument probing for this URL, keeping cross-origin postMessage as
	// the only communication channel (which works fine).
	const previewUrl =
		"https://zrg-team.github.io/memorall/hyperframes-preview.html?v=20260608-export-options";
	const [previewHtml, setPreviewHtml] = useState<NormalizedComposition | null>(
		null,
	);
	const [exportState, setExportState] = useState<ExportState>({
		phase: "idle",
	});
	const [pendingDownload, setPendingDownload] =
		useState<PendingDownload | null>(null);
	const [previewIssues, setPreviewIssues] = useState<PreviewIssue[]>([]);
	const [showExportSettings, setShowExportSettings] = useState(false);
	const [exportSettings, setExportSettings] = useState<ExportSettings>(
		DEFAULT_EXPORT_SETTINGS,
	);

	const clearPendingDownload = useCallback(() => {
		const pending = pendingDownloadRef.current;
		if (pending) URL.revokeObjectURL(pending.url);
		pendingDownloadRef.current = null;
		setPendingDownload(null);
	}, []);

	// Normalise the composition HTML (inline stale blob scripts, convert images).
	useEffect(() => {
		let cancelled = false;
		clearPendingDownload();
		setExportState({ phase: "idle" });
		setPreviewIssues([]);
		setShowExportSettings(false);
		setPreviewHtml(null);
		void normalizeHyperframesHtml(content, projectPath).then((result) => {
			if (!cancelled) setPreviewHtml(result);
		});
		return () => {
			cancelled = true;
		};
	}, [clearPendingDownload, content, projectPath]);

	// Deliver the composition to the GitHub Pages runner via postMessage.
	//
	// Race-condition handling (no timeouts):
	//   The runner retries sending "ready" every 100 ms until it receives
	//   the composition HTML, so we only need one message listener here — no
	//   manual retry loop required.
	const postComposition = useCallback(
		(
			player: HyperframesPlayerElement,
			key: string,
			composition: NormalizedComposition,
			filenameBase: string,
		): void => {
			try {
				player.iframeElement?.contentWindow?.postMessage(
					{
						type: "memorall:hyperframes-composition",
						key,
						html: composition.html,
						inlineScripts: composition.inlineScripts,
						filenameBase,
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
		clearPendingDownload();
		setExportState({ phase: "idle" });
		setPreviewIssues([]);
		const key = `memorall-hyperframes:${Date.now()}:${Math.random()
			.toString(36)
			.slice(2)}`;
		compositionKeyRef.current = key;
		const compositionUrl = new URL(previewUrl);
		compositionUrl.hash = `composition=${encodeURIComponent(key)}`;
		const composition = previewHtml; // capture non-null for closure
		const filenameBase = safeFilenameBase(title || identifier || key);
		filenameBaseRef.current = filenameBase;

		void ensureHyperframesPlayer().then(() => {
			if (cancelled) return;

			container.textContent = "";
			playerRef.current = null;
			const player = document.createElement(
				"hyperframes-player",
			) as HyperframesPlayerElement;
			player.setAttribute("controls", "");
			player.setAttribute("autoplay", "");
			player.setAttribute("muted", "");
			player.style.cssText = "display:block;width:100%;height:100%";
			container.appendChild(player);
			playerRef.current = player;

			// Listen for the "ready" signal from the GitHub Pages runner.
			// The runner re-sends "ready" every 100 ms so there is no race
			// condition — we never miss the signal regardless of load timing.
			const onMessage = (event: MessageEvent): void => {
				if (
					event.data?.type === "memorall:hyperframes-composition-ready" &&
					event.data.key === key
				) {
					postComposition(player, key, composition, filenameBase);
					return;
				}

				if (
					event.data?.type === "memorall:hyperframes-preview-event" &&
					event.data.key === key
				) {
					const previewEvent = isRecord(event.data.event)
						? event.data.event
						: null;
					if (previewEvent?.type === "preview.error") {
						const issue = toPreviewIssue(previewEvent.payload);
						if (issue) {
							setPreviewIssues((prev) => {
								const nextKey = formatPreviewIssue(issue);
								if (prev.some((item) => formatPreviewIssue(item) === nextKey)) {
									return prev;
								}
								return [...prev, issue].slice(-MAX_PREVIEW_ISSUES);
							});
						}
					}
					return;
				}

				if (
					event.data?.type === "memorall:hyperframes-export-status" &&
					event.data.key === key
				) {
					const status = event.data.status;
					if (status === "idle") {
						setExportState({ phase: "idle" });
					} else if (status === "preparing" || status === "busy") {
						clearPendingDownload();
						setExportState({ phase: "preparing" });
					} else if (status === "exporting") {
						setExportState({
							phase: "exporting",
							frame:
								typeof event.data.frame === "number"
									? event.data.frame
									: undefined,
							total:
								typeof event.data.total === "number"
									? event.data.total
									: undefined,
						});
					} else if (status === "complete") {
						const blob =
							event.data.blob instanceof Blob ? event.data.blob : null;
						const filename =
							typeof event.data.filename === "string"
								? event.data.filename
								: `${filenameBase}.mp4`;
						if (blob) {
							clearPendingDownload();
							const next = {
								url: URL.createObjectURL(blob),
								filename,
							};
							pendingDownloadRef.current = next;
							setPendingDownload(next);
							setExportState({ phase: "complete" });
							setShowExportSettings(false);
						}
					} else if (status === "failed") {
						setExportState({
							phase: "failed",
							error:
								typeof event.data.error === "string"
									? event.data.error
									: "Export failed",
						});
					}
				}
			};
			window.addEventListener("message", onMessage);
			removeMessageListener = () =>
				window.removeEventListener("message", onMessage);

			// Set src last so the listener is in place before the page loads.
			player.setAttribute("src", compositionUrl.href);
		});

		return () => {
			cancelled = true;
			removeMessageListener?.();
			playerRef.current = null;
			if (compositionKeyRef.current === key) {
				compositionKeyRef.current = null;
			}
			container.textContent = "";
		};
	}, [
		clearPendingDownload,
		identifier,
		postComposition,
		previewHtml,
		previewUrl,
		title,
	]);

	useEffect(() => {
		return () => clearPendingDownload();
	}, [clearPendingDownload]);

	const handleExportClick = useCallback(() => {
		if (pendingDownloadRef.current) {
			const link = document.createElement("a");
			link.href = pendingDownloadRef.current.url;
			link.download = pendingDownloadRef.current.filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			return;
		}

		setShowExportSettings((open) => !open);
	}, []);

	const handleStartExportClick = useCallback(() => {
		const key = compositionKeyRef.current;
		const target = playerRef.current?.iframeElement?.contentWindow;
		if (!key || !target) return;

		clearPendingDownload();
		setShowExportSettings(false);
		setExportState({ phase: "preparing" });
		target.postMessage(
			{
				type: "memorall:hyperframes-export-mp4",
				key,
				filenameBase: filenameBaseRef.current,
				options: exportSettings,
			},
			"*",
		);
	}, [clearPendingDownload, exportSettings]);

	const handleSendPreviewReport = useCallback(() => {
		if (previewIssues.length === 0) return;
		void onMessageAction?.({
			type: "artifact.preview.error.report",
			component: "hyperframes",
			title,
			identifier,
			payload: {
				errors: previewIssues.map(formatPreviewIssue),
			},
		});
	}, [identifier, onMessageAction, previewIssues, title]);

	const exportBusy =
		exportState.phase === "preparing" || exportState.phase === "exporting";
	const exportLabel =
		exportState.phase === "preparing"
			? "Preparing MP4"
			: exportState.phase === "exporting"
				? exportState.total
					? `Exporting ${exportState.frame ?? 0}/${exportState.total}`
					: "Exporting MP4"
				: exportState.phase === "failed"
					? "Export failed"
					: pendingDownload || exportState.phase === "complete"
						? "Download MP4"
						: "Export MP4";

	return (
		<div className="my-2 overflow-hidden rounded-md bg-black">
			<div
				className="border-b border-white/10 bg-black"
				data-html2canvas-ignore="true"
			>
				<div className="flex items-center justify-end px-3 py-2">
					<button
						type="button"
						onClick={handleExportClick}
						disabled={exportBusy || !previewHtml}
						className="inline-flex h-8 items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/15 disabled:cursor-progress disabled:opacity-60"
						title={
							exportState.error || "Export this HyperFrames composition as MP4"
						}
					>
						{exportBusy ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : pendingDownload || exportState.phase === "complete" ? (
							<Download className="h-3.5 w-3.5" />
						) : (
							<SlidersHorizontal className="h-3.5 w-3.5" />
						)}
						<span>{exportLabel}</span>
					</button>
				</div>
				{showExportSettings && !pendingDownload ? (
					<div className="grid gap-2 border-t border-white/10 px-3 pb-3 pt-1 text-xs text-white sm:grid-cols-[1fr_1fr_1fr_auto_auto] sm:items-end">
						<label className="grid gap-1">
							<span className="font-medium text-white/70">FPS</span>
							<select
								value={exportSettings.fps}
								onChange={(event) =>
									setExportSettings((settings) => ({
										...settings,
										fps: Number(event.target.value) as ExportFps,
									}))
								}
								className="h-8 rounded-md border border-white/15 bg-black px-2 text-white outline-none focus:border-white/35"
							>
								{EXPORT_FPS_OPTIONS.map((fps) => (
									<option key={fps} value={fps}>
										{fps} fps
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1">
							<span className="font-medium text-white/70">Image quality</span>
							<select
								value={exportSettings.quality}
								onChange={(event) =>
									setExportSettings((settings) => ({
										...settings,
										quality: event.target.value as ExportQuality,
									}))
								}
								className="h-8 rounded-md border border-white/15 bg-black px-2 text-white outline-none focus:border-white/35"
							>
								{EXPORT_QUALITY_OPTIONS.map((quality) => (
									<option key={quality.value} value={quality.value}>
										{quality.label}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-1">
							<span className="font-medium text-white/70">Video size</span>
							<select
								value={exportSettings.size}
								onChange={(event) =>
									setExportSettings((settings) => ({
										...settings,
										size: event.target.value as ExportSize,
									}))
								}
								className="h-8 rounded-md border border-white/15 bg-black px-2 text-white outline-none focus:border-white/35"
							>
								{EXPORT_SIZE_OPTIONS.map((size) => (
									<option key={size.value} value={size.value}>
										{size.label}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							onClick={handleStartExportClick}
							disabled={exportBusy || !previewHtml}
							className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-white/15 bg-white px-3 font-medium text-black hover:bg-white/90 disabled:cursor-progress disabled:opacity-60"
						>
							{exportBusy ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Download className="h-3.5 w-3.5" />
							)}
							<span>Start MP4</span>
						</button>
						<button
							type="button"
							onClick={() => setShowExportSettings(false)}
							className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white hover:bg-white/15"
							title="Close export settings"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				) : null}
			</div>
			<div className="relative" style={{ height: "60vh" }}>
				<div
					ref={containerRef}
					style={{ display: "block", width: "100%", height: "100%" }}
					aria-label={title || "HyperFrames composition"}
				/>
				{previewIssues.length > 0 ? (
					<div
						className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-red-400/35 bg-black/85 p-3 text-white shadow-lg backdrop-blur"
						data-html2canvas-ignore="true"
					>
						<div className="flex items-start gap-3">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
							<div className="min-w-0 flex-1">
								<div className="text-xs font-semibold text-red-100">
									Preview reported {previewIssues.length} issue
									{previewIssues.length === 1 ? "" : "s"}
								</div>
								<div className="mt-1 max-h-20 space-y-1 overflow-auto font-mono text-[11px] leading-snug text-red-100/85">
									{previewIssues.slice(-3).map((issue) => (
										<div
											key={formatPreviewIssue(issue)}
											className="truncate"
											title={formatPreviewIssue(issue)}
										>
											{formatPreviewIssue(issue)}
										</div>
									))}
								</div>
							</div>
							<button
								type="button"
								onClick={handleSendPreviewReport}
								className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-red-200/25 bg-red-500/20 px-3 text-xs font-medium text-red-50 hover:bg-red-500/30"
								title="Send preview issue details to the agent"
							>
								<Send className="h-3.5 w-3.5" />
								<span>Send to agent</span>
							</button>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
};
