// HyperFrames GitHub Pages runner.
//
// Receives a composition via postMessage from the Memorall extension and
// renders it in this page's own DOM — no extension CSP applies here.
//
// Script src URLs are chrome-extension:// paths (rewritten by composition-
// preprocessor.ts). This page converts them back to the matching CDN URLs
// before loading, so GSAP and the HyperFrames runtime load from jsDelivr.
//
// LOAD ORDER (guaranteed by renderComposition):
//   1. Tailwind browser compiler, with preflight disabled
//   2. GSAP + shader-transitions + Lucide + D3 + Three — external CDN scripts
//   3. Lucide icon replacement                         — <i data-lucide="...">
//   4. inline animation script                         — sets window.__timelines["main"] = tl
//   5. hyperframe.runtime                              — go() reads __timelines on load

const DEFAULT_EXPORT_FPS = 30;
const EXPORT_MIN_BITRATE = 12_000_000;
const EXPORT_QUALITY_PRESETS = {
	standard: {
		captureScale: 1,
		bitsPerPixelFrame: 0.32,
		maxBitrate: 40_000_000,
	},
	high: {
		captureScale: 1.25,
		bitsPerPixelFrame: 0.55,
		maxBitrate: 90_000_000,
	},
	max: {
		captureScale: 1.5,
		bitsPerPixelFrame: 0.85,
		maxBitrate: 160_000_000,
	},
};
const DEFAULT_EXPORT_QUALITY = "max";
const EXPORT_SIZE_PRESETS = {
	native: null,
	"720p": 720,
	"1080p": 1080,
	"1440p": 1440,
	"2160p": 2160,
};
const TAILWIND_BROWSER_URL = "https://cdn.tailwindcss.com";
const MEDIABUNNY_ESM_URL =
	"https://cdn.jsdelivr.net/npm/mediabunny@1.45.2/+esm";
const LUCIDE_UMD_URL =
	"https://cdn.jsdelivr.net/npm/lucide@0.542.0/dist/umd/lucide.js";
const D3_UMD_URL = "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js";
const THREE_GLOBAL_URL =
	"https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.min.js";
const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const HYPERFRAMES_RUNTIME_URL =
	"https://cdn.jsdelivr.net/npm/@hyperframes/core@0.6.33/dist/hyperframe.runtime.iife.js";
const HYPERFRAMES_SHADER_URL =
	"https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions@0.6.33/dist/index.global.js";
const HTML2CANVAS_URL =
	"https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
const TRANSPARENT_IMAGE_URL =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

// ── CDN fallback map for extension-local script URLs ─────────────────────────
// Mirrors the CDN_TO_LOCAL map in composition-preprocessor.ts (reversed).
const CDN_MAP = {
	"gsap.min.js": GSAP_URL,
	"hyperframe.runtime.iife.js": HYPERFRAMES_RUNTIME_URL,
	"shader-transitions.global.js": HYPERFRAMES_SHADER_URL,
	"html2canvas.min.js": HTML2CANVAS_URL,
	"lucide.js": LUCIDE_UMD_URL,
	"d3.min.js": D3_UMD_URL,
	"d3.js": D3_UMD_URL,
	"three.min.js": THREE_GLOBAL_URL,
	"three.js": THREE_GLOBAL_URL,
	"tailwind.js": TAILWIND_BROWSER_URL,
};

function resolveSrc(src) {
	if (!src) return null;
	if (src.startsWith("chrome-extension://")) {
		const filename = src.split("/").pop()?.split("?")[0] ?? "";
		return CDN_MAP[filename] ?? null;
	}
	return src;
}

// ── Composition key from URL hash ─────────────────────────────────────────────
const COMPOSITION_HASH_PREFIX = "#composition=";
const keyFromLocation = () =>
	location.hash.startsWith(COMPOSITION_HASH_PREFIX)
		? decodeURIComponent(location.hash.slice(COMPOSITION_HASH_PREFIX.length))
		: null;

const key = keyFromLocation();
let html2CanvasLoad = null;
let mediabunnyLoad = null;
let tailwindLoad = null;
let currentFilenameBase = "hyperframes-composition";
let exportInProgress = false;
const reportedRuntimeErrors = new Set();

document.documentElement.style.cssText =
	"width:100%;height:100%;margin:0;overflow:hidden;background:#000";
document.body.style.cssText =
	"width:100%;height:100%;margin:0;overflow:hidden;background:#000";

if (!key) {
	document.body.textContent = "Missing HyperFrames composition key.";
} else {
	document.body.textContent = "Loading HyperFrames composition…";

	const sendReady = () =>
		window.parent.postMessage(
			{ type: "memorall:hyperframes-composition-ready", key },
			"*",
		);
	sendReady();
	const retryId = setInterval(sendReady, 100);
	const capId = setTimeout(() => clearInterval(retryId), 5000);

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg?.key !== key) return;

		if (msg?.type === "memorall:hyperframes-export-mp4") {
			const filenameBase =
				typeof msg.filenameBase === "string"
					? sanitizeFilename(msg.filenameBase)
					: currentFilenameBase;
			void handleExportRequest(filenameBase, msg.options);
			return;
		}

		if (
			msg?.type !== "memorall:hyperframes-composition" ||
			typeof msg.html !== "string"
		)
			return;

		clearInterval(retryId);
		clearTimeout(capId);

		const inlineScripts = Array.isArray(msg.inlineScripts)
			? msg.inlineScripts
			: [];
		const filenameBase =
			typeof msg.filenameBase === "string"
				? sanitizeFilename(msg.filenameBase)
				: "hyperframes-composition";
		currentFilenameBase = filenameBase;

		renderComposition(msg.html, inlineScripts, { filenameBase }).catch((error) => {
			reportRuntimeError("runtime", formatErrorMessage(error), {
				source: "renderComposition",
			});
			console.error(error);
		});
	});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeErrorDetails(details = {}) {
	return Object.fromEntries(
		Object.entries(details).filter(([, value]) => value !== undefined),
	);
}

function formatErrorMessage(error) {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "HyperFrames preview error";
}

function reportRuntimeError(kind, message, details = {}) {
	if (!key || !message) return;

	const payload = {
		kind,
		message: String(message),
		details: serializeErrorDetails(details),
	};
	const dedupeKey = JSON.stringify(payload);
	if (reportedRuntimeErrors.has(dedupeKey)) return;
	reportedRuntimeErrors.add(dedupeKey);

	window.parent.postMessage(
		{
			type: "memorall:hyperframes-preview-event",
			key,
			event: {
				type: "preview.error",
				component: "hyperframes-preview",
				payload,
			},
		},
		"*",
	);
}

function describeResourceTarget(target) {
	if (!target || target === window) return null;
	const tagName = target.tagName?.toLowerCase?.();
	const source =
		target.currentSrc ||
		target.src ||
		target.href ||
		target.getAttribute?.("src") ||
		target.getAttribute?.("href");
	if (!source && !tagName) return null;
	return {
		tagName,
		source,
	};
}

window.addEventListener("error", (event) => {
	const resource = describeResourceTarget(event.target);
	if (resource) {
		reportRuntimeError(
			"resource",
			`Failed to load ${resource.tagName || "resource"}${resource.source ? `: ${resource.source}` : ""}`,
			resource,
		);
		return;
	}

	reportRuntimeError("runtime", event.message || "Unhandled runtime error", {
		source: event.filename,
		line: event.lineno,
		column: event.colno,
		stack: event.error?.stack,
	});
});

window.addEventListener("unhandledrejection", (event) => {
	const reason = event.reason;
	reportRuntimeError("runtime", formatErrorMessage(reason), {
		source: "unhandledrejection",
		stack: reason instanceof Error ? reason.stack : undefined,
	});
});

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const ANIMATION_PAT =
	/(?:window\.__timelines|__timelines\s*=|gsap\.timeline|HyperShader\.init|window\.__hfD3|window\.__hfThree|\bd3\.|\bTHREE\.)/;

function extractFromHtml(html) {
	const out = [];
	for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
		const code = (m[1] || "").trim();
		if (code && ANIMATION_PAT.test(code)) out.push(code);
	}
	return out;
}

function mergeInlineScripts(primary, fallback) {
	const seen = new Set();
	const out = [];
	for (const code of [...primary, ...fallback]) {
		const normalized = String(code || "").trim();
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

function loadExternal(src) {
	return new Promise((resolve) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = resolve;
		s.onerror = () => {
			reportRuntimeError("resource", `Failed to load script: ${src}`, {
				tagName: "script",
				source: src,
			});
			resolve();
		};
		document.body.appendChild(s);
	});
}

function loadScriptOnce(src, test) {
	if (test()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.body.appendChild(s);
	});
}

function loadHtml2Canvas() {
	html2CanvasLoad ??= loadScriptOnce(HTML2CANVAS_URL, () => {
		return typeof window.html2canvas === "function";
	});
	return html2CanvasLoad.then(() => window.html2canvas);
}

function loadMediabunny() {
	mediabunnyLoad ??= import(MEDIABUNNY_ESM_URL);
	return mediabunnyLoad;
}

function configureTailwindRuntime() {
	window.tailwind = window.tailwind || {};
	window.tailwind.config = {
		...(window.tailwind.config || {}),
		corePlugins: {
			...window.tailwind.config?.corePlugins,
			preflight: false,
		},
		theme: {
			...window.tailwind.config?.theme,
			extend: {
				...window.tailwind.config?.theme?.extend,
				colors: {
					...window.tailwind.config?.theme?.extend?.colors,
					"hf-bg": "var(--bg)",
					"hf-ink": "var(--ink)",
					"hf-accent": "var(--accent)",
					"hf-accent-2": "var(--accent2)",
					"hf-muted": "var(--muted)",
				},
				fontFamily: {
					...window.tailwind.config?.theme?.extend?.fontFamily,
					"hf-display": "var(--font-display)",
					"hf-data": "var(--font-data)",
				},
			},
		},
	};
}

function loadTailwindRuntime() {
	configureTailwindRuntime();
	if (document.querySelector(`script[src="${TAILWIND_BROWSER_URL}"]`)) {
		return Promise.resolve();
	}
	tailwindLoad ??= loadScriptOnce(TAILWIND_BROWSER_URL, () =>
		Boolean(document.querySelector("style[data-tailwind]")),
	).catch((error) => {
		reportRuntimeError("resource", formatErrorMessage(error), {
			tagName: "script",
			source: TAILWIND_BROWSER_URL,
		});
	});
	return tailwindLoad;
}

async function waitForTailwindReady() {
	await waitForRaf();
	const probe = document.createElement("div");
	probe.className =
		"hf-tailwind-probe pointer-events-none absolute w-[13px] h-[7px] bg-[#123456]";
	probe.setAttribute("data-html2canvas-ignore", "true");
	probe.style.left = "-9999px";
	probe.style.top = "-9999px";
	document.body.appendChild(probe);
	await waitForRaf();
	const style = getComputedStyle(probe);
	const widthOk = Math.round(parseFloat(style.width)) === 13;
	const colorOk = style.backgroundColor === "rgb(18, 52, 86)";
	probe.remove();
	if (!widthOk || !colorOk) {
		reportRuntimeError(
			"runtime",
			"Tailwind styles did not become ready before HyperFrames preview.",
			{ source: TAILWIND_BROWSER_URL },
		);
	}
}

function runInline(code) {
	if (!code || !code.trim()) return;
	const s = document.createElement("script");
	s.textContent = code;
	document.body.appendChild(s);
}

function isGsapScript(src) {
	return /(?:^|\/)gsap(?:@|\/)|\/gsap(?:\.min)?\.js(?:\?|$)/i.test(src);
}

function isHyperframesRuntimeScript(src) {
	return /@hyperframes\/core|hyperframe\.runtime\.iife\.js/i.test(src);
}

function isShaderTransitionScript(src) {
	return /@hyperframes\/shader-transitions|shader-transitions\.global\.js|\/shader-transitions(?:\.min)?\.js/i.test(
		src,
	);
}

function isLucideScript(src) {
	return /(?:^|\/)lucide(?:@|\/)|\/lucide(?:\.min)?\.js(?:\?|$)/i.test(src);
}

function isD3Script(src) {
	return /(?:^|\/)d3(?:@|\/)|\/d3(?:\.v\d+)?(?:\.min)?\.js(?:\?|$)/i.test(
		src,
	);
}

function isThreeScript(src) {
	return /(?:^|\/)three(?:@|\/)|\/three(?:\.min)?\.js(?:\?|$)/i.test(src);
}

function isTailwindScript(src) {
	return /cdn\.tailwindcss\.com|tailwind(?:\.browser|\.min)?\.js/i.test(src);
}

function hasLucidePlaceholders(root = document) {
	return Boolean(
		root.querySelector?.("[data-lucide], .lucide-icon[data-icon]"),
	);
}

function usesD3(html) {
	return /(?:\bd3\.|window\.__hfD3|data-hf-d3|class=["'][^"']*\bhf-d3\b)/i.test(
		html,
	);
}

function usesThree(html) {
	return /(?:\bTHREE\.|window\.__hfThree|data-hf-three|class=["'][^"']*\bhf-three\b)/i.test(
		html,
	);
}

function usesGsap(html) {
	return /\bgsap\.|window\.__timelines|__timelines\s*=/.test(html);
}

function usesShaderTransitions(html) {
	return /\bHyperShader\.|@hyperframes\/shader-transitions|shader-transitions/i.test(
		html,
	);
}

const MANAGED_SCRIPT_TESTS = [
	isGsapScript,
	isShaderTransitionScript,
	isHyperframesRuntimeScript,
	isLucideScript,
	isD3Script,
	isThreeScript,
	isTailwindScript,
];

function isManagedScript(src) {
	return MANAGED_SCRIPT_TESTS.some((test) => test(src));
}

function pushUniqueScript(list, src) {
	if (!src || list.includes(src)) return;
	list.push(src);
}

function getScriptSources(compDoc) {
	return [
		...Array.from(compDoc.head.querySelectorAll("script[src]")),
		...Array.from(compDoc.body.querySelectorAll("script[src]")),
	]
		.map((s) => s.getAttribute("src"))
		.map(resolveSrc)
		.filter(Boolean);
}

function getManagedScriptPlan(html, scriptSources) {
	const external = [];
	const runtime = [];

	if (usesGsap(html) || scriptSources.some(isGsapScript)) {
		pushUniqueScript(external, GSAP_URL);
	}
	if (usesShaderTransitions(html) || scriptSources.some(isShaderTransitionScript)) {
		pushUniqueScript(external, HYPERFRAMES_SHADER_URL);
	}
	if (
		hasLucidePlaceholders(document) ||
		/(?:\blucide\.|data-lucide)/i.test(html) ||
		scriptSources.some(isLucideScript)
	) {
		pushUniqueScript(external, LUCIDE_UMD_URL);
	}
	if (usesD3(html) || scriptSources.some(isD3Script)) {
		pushUniqueScript(external, D3_UMD_URL);
	}
	if (usesThree(html) || scriptSources.some(isThreeScript)) {
		pushUniqueScript(external, THREE_GLOBAL_URL);
	}

	// The HyperFrames runtime must always load after authored timelines.
	pushUniqueScript(runtime, HYPERFRAMES_RUNTIME_URL);

	return { external, runtime };
}

function getUnmanagedScriptSources(scriptSources) {
	const unmanaged = [];
	for (const src of scriptSources) {
		if (!isManagedScript(src)) pushUniqueScript(unmanaged, src);
	}
	return unmanaged;
}

function normalizeLucidePlaceholders(root = document) {
	for (const el of root.querySelectorAll?.(".lucide-icon[data-icon]") ?? []) {
		if (!el.hasAttribute("data-lucide")) {
			el.setAttribute("data-lucide", el.getAttribute("data-icon") || "");
		}
	}
}

function renderLucideIcons() {
	normalizeLucidePlaceholders(document);
	if (!hasLucidePlaceholders(document)) return;
	if (typeof window.lucide?.createIcons !== "function") return;
	window.lucide.createIcons({
		attrs: {
			"aria-hidden": "true",
			focusable: "false",
		},
	});
}

function sanitizeFilename(value) {
	const cleaned = String(value || "")
		.trim()
		.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
	return cleaned || "hyperframes-composition";
}

function waitForRaf() {
	return new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve)),
	);
}

function pollUntil(check, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (check()) {
				resolve();
				return;
			}
			if (Date.now() - start > timeoutMs) {
				reject(new Error("Timed out waiting for HyperFrames runtime"));
				return;
			}
			setTimeout(tick, 150);
		};
		tick();
	});
}

function getRootComposition() {
	return document.querySelector("[data-composition-id]");
}

function getCompositionDimensions() {
	const root = getRootComposition();
	const width = parseInt(root?.getAttribute("data-width") || "", 10);
	const height = parseInt(root?.getAttribute("data-height") || "", 10);
	return {
		width: Number.isFinite(width) && width > 0 ? width : 1920,
		height: Number.isFinite(height) && height > 0 ? height : 1080,
	};
}

function normalizeExportOptions(options = {}) {
	const fps = Number(options?.fps);
	const quality =
		typeof options?.quality === "string" &&
		EXPORT_QUALITY_PRESETS[options.quality]
			? options.quality
			: DEFAULT_EXPORT_QUALITY;
	const size =
		typeof options?.size === "string" && options.size in EXPORT_SIZE_PRESETS
			? options.size
			: "native";

	return {
		fps: Number.isFinite(fps) ? Math.round(clamp(fps, 24, 30)) : DEFAULT_EXPORT_FPS,
		quality,
		size,
	};
}

function roundToEven(value) {
	const rounded = Math.max(2, Math.round(value));
	return rounded % 2 === 0 ? rounded : rounded + 1;
}

function getExportOutputDimensions(sourceWidth, sourceHeight, size) {
	const longEdge = EXPORT_SIZE_PRESETS[size];
	if (!longEdge) {
		return {
			width: roundToEven(sourceWidth),
			height: roundToEven(sourceHeight),
		};
	}

	const aspect = sourceWidth / sourceHeight;
	if (sourceWidth >= sourceHeight) {
		return {
			width: roundToEven(longEdge),
			height: roundToEven(longEdge / aspect),
		};
	}

	return {
		width: roundToEven(longEdge * aspect),
		height: roundToEven(longEdge),
	};
}

function withCompositionExportViewport(width, height) {
	const root = getRootComposition();
	const targets = [document.documentElement, document.body, root].filter(Boolean);
	const snapshots = targets.map((el) => ({
		el,
		style: el.getAttribute("style"),
	}));

	document.documentElement.style.width = `${width}px`;
	document.documentElement.style.height = `${height}px`;
	document.documentElement.style.margin = "0";
	document.documentElement.style.overflow = "hidden";
	document.documentElement.style.background = "#000";

	document.body.style.width = `${width}px`;
	document.body.style.height = `${height}px`;
	document.body.style.margin = "0";
	document.body.style.overflow = "hidden";
	document.body.style.background = "#000";

	if (root) {
		root.style.width = `${width}px`;
		root.style.height = `${height}px`;
		if (getComputedStyle(root).position === "static") {
			root.style.position = "relative";
		}
		root.style.overflow = "hidden";
	}

	return () => {
		for (const { el, style } of snapshots) {
			if (style === null) el.removeAttribute("style");
			else el.setAttribute("style", style);
		}
	};
}

function toCssUrl(value) {
	return `url("${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}")`;
}

function objectFitToBackgroundSize(objectFit) {
	switch (objectFit) {
		case "cover":
			return "cover";
		case "contain":
		case "scale-down":
			return "contain";
		case "none":
			return "auto";
		default:
			return null;
	}
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function getExportBitrate(width, height, fps, quality) {
	const preset =
		EXPORT_QUALITY_PRESETS[quality] ?? EXPORT_QUALITY_PRESETS[DEFAULT_EXPORT_QUALITY];
	return Math.ceil(
		clamp(
			width * height * fps * preset.bitsPerPixelFrame,
			EXPORT_MIN_BITRATE,
			preset.maxBitrate,
		),
	);
}

function getColorAlpha(color) {
	if (!color || color === "transparent") return 0;
	const match = color.match(/^rgba?\((.*)\)$/i);
	if (!match) return 1;

	const parts = match[1]
		.split(/[,\s/]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length < 4) return 1;

	const alpha = Number.parseFloat(parts[3]);
	return Number.isFinite(alpha) ? alpha : 1;
}

function preserveObjectFitImagesForHtml2Canvas(clonedDocument) {
	const clonedWindow = clonedDocument.defaultView;
	if (!clonedWindow) return;

	for (const img of clonedDocument.querySelectorAll("img")) {
		const style = clonedWindow.getComputedStyle(img);
		const backgroundSize = objectFitToBackgroundSize(style.objectFit);
		if (!backgroundSize) continue;

		const src =
			img.currentSrc ||
			img.src ||
			img.getAttribute("src") ||
			img.getAttribute("data-src");
		if (!src) continue;

		img.style.backgroundImage = toCssUrl(src);
		img.style.backgroundSize = backgroundSize;
		img.style.backgroundPosition = style.objectPosition || "50% 50%";
		img.style.backgroundRepeat = "no-repeat";
		img.style.backgroundClip = "padding-box";
		img.removeAttribute("srcset");
		img.removeAttribute("sizes");
		img.setAttribute("src", TRANSPARENT_IMAGE_URL);
	}
}

function normalizeBackdropFiltersForHtml2Canvas(clonedDocument) {
	const clonedWindow = clonedDocument.defaultView;
	if (!clonedWindow) return;

	for (const el of clonedDocument.querySelectorAll("*")) {
		const style = clonedWindow.getComputedStyle(el);
		const backdropFilter =
			style.backdropFilter || style.webkitBackdropFilter || "";
		if (!backdropFilter || backdropFilter === "none") continue;

		const htmlEl = el;
		htmlEl.style.backdropFilter = "none";
		htmlEl.style.webkitBackdropFilter = "none";

		if (getColorAlpha(style.backgroundColor) < 0.18) {
			htmlEl.style.backgroundColor = "rgba(18, 16, 28, 0.72)";
		}

		const hasBorder =
			Number.parseFloat(style.borderTopWidth || "0") > 0 ||
			Number.parseFloat(style.borderRightWidth || "0") > 0 ||
			Number.parseFloat(style.borderBottomWidth || "0") > 0 ||
			Number.parseFloat(style.borderLeftWidth || "0") > 0;
		if (hasBorder && getColorAlpha(style.borderTopColor) < 0.12) {
			htmlEl.style.borderColor = "rgba(255, 255, 255, 0.18)";
		}
	}
}

function normalizeTextSpacingForHtml2Canvas(clonedDocument) {
	const clonedWindow = clonedDocument.defaultView;
	const root = clonedDocument.body;
	if (!clonedWindow || !root) return;

	const style = clonedDocument.createElement("style");
	style.setAttribute("data-html2canvas-ignore", "true");
	style.textContent = `
[data-hf-html2canvas-text-shift] {
	position: relative !important;
	top: -0.28em !important;
}
`;
	clonedDocument.head.appendChild(style);

	const skipTags = new Set([
		"SCRIPT",
		"STYLE",
		"NOSCRIPT",
		"TEXTAREA",
		"OPTION",
		"SELECT",
		"SVG",
		"CANVAS",
		"VIDEO",
		"AUDIO",
	]);
	const walker = clonedDocument.createTreeWalker(
		root,
		clonedWindow.NodeFilter.SHOW_TEXT,
		{
			acceptNode: (node) => {
				if (!node.nodeValue?.trim()) return clonedWindow.NodeFilter.FILTER_REJECT;

				const parent = node.parentElement;
				if (!parent) return clonedWindow.NodeFilter.FILTER_REJECT;
				if (parent.hasAttribute("data-hf-html2canvas-text-shift")) {
					return clonedWindow.NodeFilter.FILTER_REJECT;
				}
				if (skipTags.has(parent.tagName)) {
					return clonedWindow.NodeFilter.FILTER_REJECT;
				}
				if (parent.closest("[data-html2canvas-ignore]")) {
					return clonedWindow.NodeFilter.FILTER_REJECT;
				}
				return clonedWindow.NodeFilter.FILTER_ACCEPT;
			},
		},
	);
	const textNodes = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode);

	for (const textNode of textNodes) {
		const wrapper = clonedDocument.createElement("span");
		wrapper.setAttribute("data-hf-html2canvas-text-shift", "true");
		textNode.parentNode?.insertBefore(wrapper, textNode);
		wrapper.appendChild(textNode);
	}
}

function prepareFallbackHtml2CanvasClone(clonedDocument) {
	preserveObjectFitImagesForHtml2Canvas(clonedDocument);
	normalizeBackdropFiltersForHtml2Canvas(clonedDocument);
	normalizeTextSpacingForHtml2Canvas(clonedDocument);
}

function getHtml2CanvasCaptureOptions(width, height, scale = 1, overrides = {}) {
	return {
		useCORS: true,
		allowTaint: false,
		backgroundColor: "#000",
		scale,
		width,
		height,
		windowWidth: width,
		windowHeight: height,
		scrollX: 0,
		scrollY: 0,
		x: 0,
		y: 0,
		ignoreElements: (el) =>
			el.hasAttribute("data-html2canvas-ignore") ||
			Boolean(el.closest?.("[data-html2canvas-ignore]")),
		...overrides,
	};
}

function assertCaptureDimensions(
	canvas,
	width,
	height,
	scale,
	rendererName,
) {
	const expectedWidth = Math.round(width * scale);
	const expectedHeight = Math.round(height * scale);
	if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
		throw new Error(
			`${rendererName} produced ${canvas.width}x${canvas.height}; expected ${expectedWidth}x${expectedHeight}`,
		);
	}
}

async function captureCompositionCanvas(html2canvas, width, height, scale) {
	try {
		const canvas = await html2canvas(
			document.body,
			getHtml2CanvasCaptureOptions(width, height, scale, {
				foreignObjectRendering: true,
			}),
		);
		assertCaptureDimensions(
			canvas,
			width,
			height,
			scale,
			"foreignObject html2canvas",
		);
		return canvas;
	} catch (error) {
		reportRuntimeError(
			"runtime",
			"Foreign-object export capture failed; using compatibility capture.",
			{
				source: "exportMp4",
				error: formatErrorMessage(error),
			},
		);
	}

	const fallbackCanvas = await html2canvas(
		document.body,
		getHtml2CanvasCaptureOptions(width, height, scale, {
			onclone: prepareFallbackHtml2CanvasClone,
		}),
	);
	assertCaptureDimensions(
		fallbackCanvas,
		width,
		height,
		scale,
		"fallback html2canvas",
	);
	return fallbackCanvas;
}

async function waitForFontsReady() {
	try {
		await document.fonts?.ready;
	} catch {
		// Font readiness is best effort. Capture still proceeds with browser fallback.
	}
}

function waitForImageReady(img) {
	if (img.complete && img.naturalWidth > 0) return Promise.resolve();

	const decoded = typeof img.decode === "function" ? img.decode() : null;
	if (decoded) {
		return decoded.catch(() => undefined);
	}

	return new Promise((resolve) => {
		const done = () => resolve();
		img.addEventListener("load", done, { once: true });
		img.addEventListener("error", done, { once: true });
	});
}

async function waitForImagesReady(root = document) {
	await Promise.all(
		Array.from(root.querySelectorAll("img")).map((img) => waitForImageReady(img)),
	);
}

async function prepareExportFrame(timestamp) {
	seekComposition(timestamp);
	await waitForRaf();
	await waitForFontsReady();
	await waitForImagesReady(document);
	await waitForRaf();
}

function reportUndersizedImagesForExport() {
	for (const img of document.querySelectorAll("img")) {
		if (!img.naturalWidth || !img.naturalHeight) continue;
		const rect = img.getBoundingClientRect();
		if (rect.width <= 1 || rect.height <= 1) continue;

		const widthScale = rect.width / img.naturalWidth;
		const heightScale = rect.height / img.naturalHeight;
		const maxScale = Math.max(widthScale, heightScale);
		if (maxScale <= 1.15) continue;

		reportRuntimeError(
			"runtime",
			"Image asset is smaller than its export display box; MP4 may look soft.",
			{
				source: "exportMp4",
				displayWidth: Math.round(rect.width),
				displayHeight: Math.round(rect.height),
				naturalWidth: img.naturalWidth,
				naturalHeight: img.naturalHeight,
				src: img.currentSrc || img.src || img.getAttribute("src") || "",
			},
		);
	}
}

function getRootTimeline() {
	const timelines = window.__timelines;
	if (!timelines || typeof timelines !== "object") return null;

	const compositionId = getRootComposition()?.getAttribute("data-composition-id");
	if (compositionId && timelines[compositionId]) return timelines[compositionId];

	const keys = Object.keys(timelines);
	return keys.length > 0 ? timelines[keys[keys.length - 1]] : null;
}

function getDuration() {
	const runtimeDuration = window.__player?.getDuration?.();
	if (Number.isFinite(runtimeDuration) && runtimeDuration > 0) {
		return runtimeDuration;
	}

	const timelineDuration = getRootTimeline()?.duration?.();
	if (Number.isFinite(timelineDuration) && timelineDuration > 0) {
		return timelineDuration;
	}

	const authoredDuration = parseFloat(
		getRootComposition()?.getAttribute("data-duration") || "",
	);
	if (Number.isFinite(authoredDuration) && authoredDuration > 0) {
		return authoredDuration;
	}

	let maxEnd = 0;
	for (const el of document.querySelectorAll("[data-start][data-duration]")) {
		const start = parseFloat(el.getAttribute("data-start") || "0");
		const duration = parseFloat(el.getAttribute("data-duration") || "0");
		if (Number.isFinite(start) && Number.isFinite(duration)) {
			maxEnd = Math.max(maxEnd, start + duration);
		}
	}
	return maxEnd;
}

function seekComposition(time) {
	const player = window.__player;
	if (typeof player?.renderSeek === "function") {
		player.renderSeek(time);
		return;
	}
	if (typeof player?.seek === "function") {
		player.seek(time);
		return;
	}

	const timeline = getRootTimeline();
	if (!timeline) throw new Error("No HyperFrames timeline found");
	timeline.pause?.();
	if (typeof timeline.totalTime === "function") timeline.totalTime(time, false);
	else if (typeof timeline.seek === "function") timeline.seek(time, false);
	else throw new Error("Timeline does not support seeking");
}

function hasExportRuntime() {
	return getDuration() > 0 && (window.__player || getRootTimeline());
}

function postExportStatus(payload) {
	window.parent.postMessage(
		{
			type: "memorall:hyperframes-export-status",
			key,
			...payload,
		},
		"*",
	);
}

async function handleExportRequest(filenameBase, options) {
	if (exportInProgress) {
		postExportStatus({ status: "busy" });
		return;
	}

	exportInProgress = true;
	try {
		postExportStatus({ status: "preparing" });
		const result = await exportMp4({
			filenameBase,
			options,
			onProgress: (frame, total) =>
				postExportStatus({ status: "exporting", frame, total }),
		});
		postExportStatus({
			status: "complete",
			blob: result.blob,
			filename: result.filename,
		});
	} catch (error) {
		console.error(error);
		postExportStatus({
			status: "failed",
			error: error instanceof Error ? error.message : "Export failed",
		});
	} finally {
		exportInProgress = false;
	}
}

async function exportMp4({ filenameBase, options, onProgress }) {
	await pollUntil(hasExportRuntime, 20000);

	const [html2canvas, mediabunny] = await Promise.all([
		loadHtml2Canvas(),
		loadMediabunny(),
	]);
	const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } = mediabunny;

	const exportOptions = normalizeExportOptions(options);
	const sourceDimensions = getCompositionDimensions();
	const outputDimensions = getExportOutputDimensions(
		sourceDimensions.width,
		sourceDimensions.height,
		exportOptions.size,
	);
	const qualityPreset = EXPORT_QUALITY_PRESETS[exportOptions.quality];
	const duration = getDuration();
	if (!duration || duration <= 0) {
		throw new Error("Could not read composition duration");
	}

	const captureCanvas = document.createElement("canvas");
	captureCanvas.width = outputDimensions.width;
	captureCanvas.height = outputDimensions.height;
	const ctx = captureCanvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Could not create capture canvas");
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";

	const bufferTarget = new BufferTarget();
	const videoSource = new CanvasSource(captureCanvas, {
		codec: "avc",
		bitrate: getExportBitrate(
			outputDimensions.width,
			outputDimensions.height,
			exportOptions.fps,
			exportOptions.quality,
		),
		bitrateMode: "variable",
		latencyMode: "quality",
		keyFrameInterval: 2,
	});
	const output = new Output({
		format: new Mp4OutputFormat(),
		target: bufferTarget,
	});
	output.addVideoTrack(videoSource);
	await output.start();

	const totalFrames = Math.ceil(duration * exportOptions.fps);
	const frameDuration = 1 / exportOptions.fps;
	const restoreViewport = withCompositionExportViewport(
		sourceDimensions.width,
		sourceDimensions.height,
	);

	try {
		await prepareExportFrame(0);
		reportUndersizedImagesForExport();

		for (let i = 0; i < totalFrames; i++) {
			const timestamp = i * frameDuration;
			await prepareExportFrame(timestamp);

			const frameCanvas = await captureCompositionCanvas(
				html2canvas,
				sourceDimensions.width,
				sourceDimensions.height,
				qualityPreset.captureScale,
			);

			ctx.clearRect(0, 0, outputDimensions.width, outputDimensions.height);
			ctx.drawImage(
				frameCanvas,
				0,
				0,
				outputDimensions.width,
				outputDimensions.height,
			);
			await videoSource.add(timestamp, frameDuration);
			onProgress?.(i + 1, totalFrames);
		}
	} finally {
		restoreViewport();
	}

	videoSource.close();
	await output.finalize();

	const buffer = bufferTarget.buffer;
	if (!buffer) throw new Error("No MP4 buffer produced");

	const blob = new Blob([buffer], { type: "video/mp4" });
	return {
		blob,
		filename: `${sanitizeFilename(filenameBase)}.mp4`,
	};
}

// ── Main render ───────────────────────────────────────────────────────────────

async function renderComposition(html, inlineScripts, options = {}) {
	const compDoc = new DOMParser().parseFromString(html, "text/html");

	for (const a of Array.from(compDoc.documentElement.attributes))
		document.documentElement.setAttribute(a.name, a.value);
	for (const a of Array.from(compDoc.body.attributes))
		document.body.setAttribute(a.name, a.value);

	const charsetMeta = document.head.querySelector("meta[charset]");
	document.head.innerHTML = "";
	if (charsetMeta) document.head.appendChild(charsetMeta);
	for (const el of Array.from(compDoc.head.children)) {
		if (el.tagName !== "SCRIPT") document.head.appendChild(el.cloneNode(true));
	}

	const bodyClone = compDoc.body.cloneNode(true);
	for (const s of Array.from(bodyClone.querySelectorAll("script"))) s.remove();
	document.body.innerHTML = "";
	while (bodyClone.firstChild) document.body.appendChild(bodyClone.firstChild);

	normalizeLucidePlaceholders(document);

	const scriptSources = getScriptSources(compDoc);
	const unmanagedSrcs = getUnmanagedScriptSources(scriptSources);
	const managedScripts = getManagedScriptPlan(html, scriptSources);

	const scripts = mergeInlineScripts(inlineScripts, extractFromHtml(html));

	// Step 1: Tailwind browser compiler. Preflight is disabled so existing
	// direct-CSS compositions do not receive Tailwind base resets.
	await loadTailwindRuntime();
	await waitForTailwindReady();

	// Step 2: GSAP, shader-transitions, Lucide, D3, Three
	for (const src of [...managedScripts.external, ...unmanagedSrcs]) {
		await loadExternal(src);
	}

	// Step 3: replace simple Lucide placeholders before animations target them.
	renderLucideIcons();

	// Step 4: inline animation — sets window.__timelines["main"] = tl
	for (const code of scripts) runInline(code);

	// Step 5: hyperframe.runtime — go() now finds __timelines populated
	for (const src of managedScripts.runtime) await loadExternal(src);
	currentFilenameBase = options.filenameBase || currentFilenameBase;
	postExportStatus({ status: "idle" });
}
