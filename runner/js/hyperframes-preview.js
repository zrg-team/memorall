// HyperFrames Manifest V3 sandbox runner.
//
// Receives a composition via postMessage from the Memorall extension and
// renders it in an isolated manifest sandbox using only packaged runtimes.
//
// Loaded as a module (type="module"): nothing it declares, nor what the
// bundler adds around it, lands in the page's global scope, where the
// composition's own scripts declare their globals (a top-level `let c` in a
// classic script made a composition's `var c` a SyntaxError).
//
// LOAD ORDER (guaranteed by renderComposition):
//   1. Tailwind browser compiler (v4, theme utilities, preflight on)
//   2. GSAP + shader-transitions + Lucide + D3 + Three — packaged runtimes
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
const DEFAULT_EXPORT_QUALITY = "high";
// What never belongs in an exported frame: this page's own overlays and
// HyperShader's loading card.
const CAPTURE_IGNORE_SELECTOR =
	"[data-html2canvas-ignore],[data-no-capture],[data-hf-ignore]";
// How long export waits for HyperShader to finish sampling its transitions.
const SHADER_READY_TIMEOUT_MS = 60_000;
const EXPORT_SIZE_PRESETS = {
	native: null,
	"720p": 720,
	"1080p": 1080,
	"1440p": 1440,
	"2160p": 2160,
};
const packagedVendorUrl = (path) =>
	new URL(`../../vendors/${path}`, globalThis.location.href).href;
const TAILWIND_BROWSER_URL = packagedVendorUrl("artifacts/tailwind.js");
const MEDIABUNNY_ESM_URL = packagedVendorUrl(
	"artifacts/mediabunny.min.mjs",
);
const LUCIDE_UMD_URL = packagedVendorUrl("artifacts/lucide.min.js");
const D3_UMD_URL = packagedVendorUrl("artifacts/d3.min.js");
const THREE_ESM_URL = packagedVendorUrl("artifacts/three.min.mjs");
const GSAP_URL = packagedVendorUrl("hyperframes/gsap.min.js");
const HYPERFRAMES_RUNTIME_URL = packagedVendorUrl(
	"hyperframes/hyperframe.runtime.iife.js",
);
const HYPERFRAMES_SHADER_URL = packagedVendorUrl(
	"hyperframes/shader-transitions.global.js",
);
const HTML2CANVAS_URL = packagedVendorUrl(
	"hyperframes/html2canvas.min.js",
);

// ── CDN fallback map for extension-local script URLs ─────────────────────────
// Mirrors the CDN_TO_LOCAL map in composition-preprocessor.ts (reversed).
const PACKAGED_RUNTIME_MAP = {
	"gsap.min.js": GSAP_URL,
	"hyperframe.runtime.iife.js": HYPERFRAMES_RUNTIME_URL,
	"shader-transitions.global.js": HYPERFRAMES_SHADER_URL,
	"html2canvas.min.js": HTML2CANVAS_URL,
	"lucide.js": LUCIDE_UMD_URL,
	"d3.min.js": D3_UMD_URL,
	"d3.js": D3_UMD_URL,
	"three.min.js": THREE_ESM_URL,
	"three.js": THREE_ESM_URL,
	"three.min.mjs": THREE_ESM_URL,
	"tailwind.js": TAILWIND_BROWSER_URL,
};

function resolveSrc(src) {
	if (!src) return null;
	if (src.startsWith("chrome-extension://")) {
		const filename = src.split("/").pop()?.split("?")[0] ?? "";
		return PACKAGED_RUNTIME_MAP[filename] ?? null;
	}
	if (/^https?:\/\//i.test(src)) return null;
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
let threeLoad = null;
let currentFilenameBase = "hyperframes-composition";
let exportInProgress = false;
let exportCancelled = false;
// "dom": the page serialises itself into an SVG image per frame (fast, keeps
// canvases). "html2canvas": the fallback when that fails.
let captureMode = "dom";
let compositionAccepted = false;
const reportedRuntimeErrors = new Set();

document.documentElement.style.cssText =
	"width:100%;height:100%;margin:0;overflow:hidden;background:#000";
document.body.style.cssText =
	"width:100%;height:100%;margin:0;overflow:hidden;background:#000";

// The page defaults under a composition: any rule it has wins over these.
const PAGE_BASE_CSS =
	":where(html,body){width:100%;height:100%;margin:0;overflow:hidden;background:#000}";

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

		if (msg?.type === "memorall:hyperframes-export-cancel") {
			if (exportInProgress) exportCancelled = true;
			return;
		}

		if (
			msg?.type !== "memorall:hyperframes-composition" ||
			typeof msg.html !== "string"
		)
			return;

		clearInterval(retryId);
		clearTimeout(capId);
		// The host answers every ready ping, so copies arrive while the first
		// one renders. Rendering again would run the composition's scripts a
		// second time on the live page: its from() tweens then record whatever
		// the first timeline left on screen, and every element past that point
		// stays invisible. A new composition comes with a new key and page.
		if (compositionAccepted) return;
		compositionAccepted = true;

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

/**
 * Loads scripts in parallel but runs them in the given order (async=false),
 * so GSAP is there before the plugins and shaders that need it.
 */
function loadExternalInOrder(sources) {
	return Promise.all(
		sources.map(
			(src) =>
				new Promise((resolve) => {
					const s = document.createElement("script");
					s.src = src;
					s.async = false;
					s.onload = resolve;
					s.onerror = () => {
						reportRuntimeError("resource", `Failed to load script: ${src}`, {
							tagName: "script",
							source: src,
						});
						resolve();
					};
					document.body.appendChild(s);
				}),
		),
	);
}

// Chrome pauses animation frames in a cross-origin frame it does not show,
// and the player keeps this page hidden (0×0, behind its loading card) until
// the composition is ready, while HyperShader's transition sampling and the
// runtime wait on frames to get ready: nothing would ever move. Here a frame
// callback runs on the next frame, or after FRAME_FALLBACK_MS when frames
// are paused, whichever comes first, once. Shown, nothing changes.
const FRAME_FALLBACK_MS = 100;
(() => {
	const requestFrame = window.requestAnimationFrame.bind(window);
	const cancelFrame = window.cancelAnimationFrame.bind(window);
	const pending = new Map();
	let seq = 0;
	window.requestAnimationFrame = (callback) => {
		const id = ++seq;
		const entry = { frame: 0, timer: 0 };
		const run = (time) => {
			if (!pending.delete(id)) return;
			cancelFrame(entry.frame);
			clearTimeout(entry.timer);
			callback(typeof time === "number" ? time : performance.now());
		};
		pending.set(id, entry);
		entry.frame = requestFrame(run);
		entry.timer = setTimeout(() => run(performance.now()), FRAME_FALLBACK_MS);
		return id;
	};
	window.cancelAnimationFrame = (id) => {
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		cancelFrame(entry.frame);
		clearTimeout(entry.timer);
	};
})();

// A manifest sandbox page has an opaque origin, where indexedDB.open throws.
// HyperShader caches its sampled transitions in IndexedDB and works without
// a cache when there is no indexedDB, but a throwing open fails the whole
// capture, leaving plain fades. Without storage here, there is no indexedDB.
(() => {
	if (window.origin !== "null") return;
	try {
		Object.defineProperty(window, "indexedDB", {
			value: undefined,
			configurable: true,
		});
	} catch {
		// Keep going: transitions then fall back to fades.
	}
})();

// Exported frames read WebGL canvases (Three.js, shaders) after they drew;
// without a preserved drawing buffer that read comes back blank.
(() => {
	const getContext = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function (type, attributes) {
		if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
			return getContext.call(this, type, {
				...(attributes || {}),
				preserveDrawingBuffer: true,
			});
		}
		return getContext.call(this, type, attributes);
	};
})();

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
	mediabunnyLoad ??= import(/* webpackIgnore: true */ MEDIABUNNY_ESM_URL);
	return mediabunnyLoad;
}

function loadThree() {
	threeLoad ??= import(/* webpackIgnore: true */ THREE_ESM_URL).then((three) => {
		// Preserve the composition-facing global API after Three.js removed its UMD
		// build. Authored HyperFrames compositions intentionally keep using THREE.*.
		window.THREE = three;
		return three;
	});
	return threeLoad;
}

// Tailwind v4's browser build reads its configuration from
// <style type="text/tailwindcss">, not from a window.tailwind.config object
// (Tailwind v3). The HyperFrames theme utilities (bg-hf-bg, text-hf-ink,
// font-hf-display, ...) resolve to the composition's :root variables.
// Preflight stays on: every composition so far was laid out with it.
const TAILWIND_THEME_CSS = `@import "tailwindcss";
@theme inline {
  --color-hf-bg: var(--bg);
  --color-hf-ink: var(--ink);
  --color-hf-accent: var(--accent);
  --color-hf-accent-2: var(--accent2);
  --color-hf-muted: var(--muted);
  --font-hf-display: var(--font-display);
  --font-hf-body: var(--font-body);
  --font-hf-data: var(--font-data);
}`;

function configureTailwindRuntime() {
	if (document.querySelector("style[data-hf-tailwind-theme]")) return;
	const style = document.createElement("style");
	style.type = "text/tailwindcss";
	style.setAttribute("data-hf-tailwind-theme", "");
	style.textContent = TAILWIND_THEME_CSS;
	document.head.appendChild(style);
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
		"hf-tailwind-probe pointer-events-none absolute w-[13px] h-[7px] bg-[#123456] font-hf-data";
	probe.setAttribute("data-html2canvas-ignore", "true");
	probe.style.left = "-9999px";
	probe.style.top = "-9999px";
	probe.style.setProperty("--font-data", "hf-probe-font");
	document.body.appendChild(probe);
	await waitForRaf();
	const style = getComputedStyle(probe);
	const widthOk = Math.round(parseFloat(style.width)) === 13;
	const colorOk = style.backgroundColor === "rgb(18, 52, 86)";
	// The theme utilities too, not only arbitrary values.
	const themeOk = style.fontFamily.includes("hf-probe-font");
	probe.remove();
	if (!widthOk || !colorOk || !themeOk) {
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
	return /(?:^|\/)three(?:@|\/)|\/three(?:\.min)?\.m?js(?:\?|$)/i.test(src);
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
	const three = usesThree(html) || scriptSources.some(isThreeScript);

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
	// The HyperFrames runtime must always load after authored timelines.
	pushUniqueScript(runtime, HYPERFRAMES_RUNTIME_URL);

	return { external, runtime, three };
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

// Two frames, or two short timeouts: Chrome pauses animation frames in a
// cross-origin frame it does not show (this sandbox page, while the player
// still hides it behind its loading card), and nothing here may wait on one.
async function waitForRaf() {
	await nextPaint();
	await nextPaint();
}

function pollUntil(check, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			let done = false;
			try {
				done = check();
			} catch (error) {
				reject(error);
				return;
			}
			if (done) {
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
		fps: Number.isFinite(fps) ? Math.round(clamp(fps, 24, 60)) : DEFAULT_EXPORT_FPS,
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

	// No background here: the composition's own html/body fill must show, and
	// frames are drawn over black anyway.
	document.body.style.width = `${width}px`;
	document.body.style.height = `${height}px`;
	document.body.style.margin = "0";
	document.body.style.overflow = "hidden";

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
		// HyperShader marks its "Preparing scene transitions" card data-no-capture.
		ignoreElements: (el) =>
			Boolean(el.closest?.(CAPTURE_IGNORE_SELECTOR)),
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

// ── DOM capture ───────────────────────────────────────────────────────────────
// The page draws itself: its DOM, as GSAP left it for this frame, serialised
// into an SVG foreignObject image. No per-frame document clone into a new
// iframe as html2canvas does, so a frame takes a fraction of the time, and
// canvases and video frames (Three.js, D3 canvas, <video>) are kept as images
// where html2canvas's foreignObject mode drops them.

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function isPaintedBox(el) {
	const rect = el.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return false;
	const style = getComputedStyle(el);
	return style.display !== "none" && style.visibility !== "hidden";
}

/** A data URL of what a canvas or video shows now, or null. */
function snapshotPixels(el) {
	try {
		if (el instanceof HTMLCanvasElement) {
			if (!el.width || !el.height || !isPaintedBox(el)) return null;
			return el.toDataURL("image/png");
		}
		if (el instanceof HTMLVideoElement) {
			if (!el.videoWidth || el.readyState < 2 || !isPaintedBox(el)) return null;
			const frame = document.createElement("canvas");
			frame.width = el.videoWidth;
			frame.height = el.videoHeight;
			frame.getContext("2d")?.drawImage(el, 0, 0);
			return frame.toDataURL("image/png");
		}
	} catch {
		// A tainted canvas or video cannot be read: leave it out of the frame.
	}
	return null;
}

function effectiveOpacity(el) {
	let opacity = 1;
	for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
		opacity *= Number.parseFloat(getComputedStyle(node).opacity) || 0;
	}
	return opacity;
}

/**
 * Canvases that cover the whole frame above everything else, as HyperShader's
 * transition canvas does: drawn straight onto the frame after the page, which
 * is far cheaper than encoding them into the page image. Any other canvas
 * keeps its place in the page's stacking order through the image.
 */
function overlayCanvases(width, height) {
	const overlays = [];
	for (const canvas of document.querySelectorAll("canvas")) {
		if (!canvas.width || !canvas.height || !isPaintedBox(canvas)) continue;
		const style = getComputedStyle(canvas);
		if (style.position !== "absolute" && style.position !== "fixed") continue;
		if (style.mixBlendMode !== "normal" || style.filter !== "none") continue;
		const rect = canvas.getBoundingClientRect();
		if (
			rect.left > 1 ||
			rect.top > 1 ||
			rect.width < width - 2 ||
			rect.height < height - 2
		) {
			continue;
		}
		const z = Number.parseInt(style.zIndex, 10);
		if (!Number.isFinite(z)) continue;
		const above = [...(canvas.parentElement?.children ?? [])].some((sibling) => {
			if (sibling === canvas || !isPaintedBox(sibling)) return false;
			const siblingZ = Number.parseInt(getComputedStyle(sibling).zIndex, 10);
			return Number.isFinite(siblingZ) && siblingZ >= z;
		});
		if (!above) overlays.push({ canvas, rect, opacity: effectiveOpacity(canvas) });
	}
	return overlays;
}

function serializeCompositionFrame(width, height, skip = new Set()) {
	const live = [...document.querySelectorAll("canvas,video")];
	const pixels = live.map((el) => (skip.has(el) ? null : snapshotPixels(el)));
	const clone = document.documentElement.cloneNode(true);
	const copies = [...clone.querySelectorAll("canvas,video")];
	copies.forEach((copy, index) => {
		const original = live[index];
		const src = pixels[index];
		if (!original || !src) {
			copy.remove();
			return;
		}
		const img = document.createElementNS(XHTML_NS, "img");
		for (const attr of original.attributes) {
			if (!["width", "height", "src", "poster", "srcset"].includes(attr.name)) {
				img.setAttribute(attr.name, attr.value);
			}
		}
		const style = getComputedStyle(original);
		img.style.width = style.width;
		img.style.height = style.height;
		if (original instanceof HTMLVideoElement) {
			img.style.objectFit = style.objectFit;
			img.style.objectPosition = style.objectPosition;
		}
		img.setAttribute("src", src);
		copy.replaceWith(img);
	});
	for (const el of clone.querySelectorAll(
		`script,noscript,${CAPTURE_IGNORE_SELECTOR},${FONT_STYLE_SELECTOR}`,
	)) {
		el.remove();
	}
	clone.style.width = `${width}px`;
	clone.style.height = `${height}px`;
	return new XMLSerializer().serializeToString(clone);
}

// The bundled @font-face rules the host adds (data URLs, often 100+ KB) are
// the same in every frame: encoded once per export, spliced into each frame.
const FONT_STYLE_SELECTOR = "style[data-hf-bundled-fonts]";
let encodedFontStyle = null;

function encodedFontStyleFor() {
	if (encodedFontStyle !== null) return encodedFontStyle;
	const styles = [...document.querySelectorAll(FONT_STYLE_SELECTOR)];
	const css = styles.map((style) => style.textContent || "").join("\n");
	encodedFontStyle = css
		? encodeURIComponent(
				`<style xmlns="${XHTML_NS}">${css.replace(/]]>/g, "")}</style>`,
			)
		: "";
	return encodedFontStyle;
}

async function captureCompositionDom(width, height, scale) {
	const overlays = overlayCanvases(width, height);
	const xhtml = serializeCompositionFrame(
		width,
		height,
		new Set(overlays.map((overlay) => overlay.canvas)),
	);
	const { canvas, ctx } = await drawSerializedPage(xhtml, width, height, scale, "#000");
	for (const overlay of overlays) {
		ctx.globalAlpha = overlay.opacity;
		ctx.drawImage(
			overlay.canvas,
			overlay.rect.left * scale,
			overlay.rect.top * scale,
			overlay.rect.width * scale,
			overlay.rect.height * scale,
		);
	}
	ctx.globalAlpha = 1;
	// Reading one pixel proves the frame can be encoded (not tainted).
	ctx.getImageData(0, 0, 1, 1);
	return canvas;
}

/** Draws a serialized page (XHTML) onto a new canvas, through an SVG image. */
async function drawSerializedPage(xhtml, width, height, scale, background) {
	const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">`;
	const svgClose = "</foreignObject></svg>";
	// Fonts go first inside <head>, where the host put them.
	const headOpen = /<head\b[^>]*>/i.exec(xhtml);
	const split = headOpen ? headOpen.index + headOpen[0].length : 0;
	// A data URL, not a blob URL: Chrome taints canvases that draw a
	// foreignObject SVG loaded from a blob URL.
	const image = new Image();
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgOpen + xhtml.slice(0, split))}${encodedFontStyleFor()}${encodeURIComponent(xhtml.slice(split) + svgClose)}`;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(width * scale);
	canvas.height = Math.round(height * scale);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not create frame canvas");
	ctx.fillStyle = background || "#000";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	return { canvas, ctx };
}

const CAPTURE_TARGET = "data-hf-capture-target";

/**
 * One scene as HyperShader samples it for a transition: the element alone
 * (everything off its path hidden, canvases left out), drawn over the
 * background color. HyperShader's own capture is html2canvas, which renders
 * from a cloned iframe; in this page's opaque origin that iframe gets an
 * origin of its own and cannot be read, and every transition would fall back
 * to a fade. Installed only here (see the hook in tools/copy-bundled-assets).
 */
async function captureSceneElement(element, background, width, height, options = {}) {
	element.setAttribute(CAPTURE_TARGET, "");
	let clone;
	try {
		clone = document.documentElement.cloneNode(true);
	} finally {
		element.removeAttribute(CAPTURE_TARGET);
	}
	const target = clone.querySelector(`[${CAPTURE_TARGET}]`);
	if (!target) throw new Error("Scene to capture is not in the page");
	target.removeAttribute(CAPTURE_TARGET);
	for (const el of clone.querySelectorAll(
		`script,noscript,canvas,video,${CAPTURE_IGNORE_SELECTOR},${FONT_STYLE_SELECTOR}`,
	)) {
		el.remove();
	}
	// Only the scene shows: whatever sits beside it, up to the body, is hidden.
	for (let node = target; node && node.parentElement; node = node.parentElement) {
		if (node.tagName === "BODY") break;
		for (const sibling of node.parentElement.children) {
			if (sibling !== node && !["STYLE", "LINK", "META"].includes(sibling.tagName)) {
				sibling.style.setProperty("visibility", "hidden", "important");
			}
		}
	}
	if (options.forceVisible) {
		target.style.opacity = "1";
		target.style.setProperty("visibility", "visible", "important");
		for (const timed of target.querySelectorAll("[data-start]")) {
			timed.style.setProperty("visibility", "visible", "important");
		}
	}
	clone.style.width = `${width}px`;
	clone.style.height = `${height}px`;
	const { canvas } = await drawSerializedPage(
		new XMLSerializer().serializeToString(clone),
		width,
		height,
		options.scale ?? 1,
		background,
	);
	// HyperShader encodes every sample to a PNG blob for its textures, ~235 ms
	// a full-HD frame (64 of them for two transitions). The sample is opaque
	// (drawn over the background), so a JPEG holds it at a tenth of the cost.
	canvas.toBlob = (callback) =>
		HTMLCanvasElement.prototype.toBlob.call(
			canvas,
			callback,
			"image/jpeg",
			SCENE_SAMPLE_JPEG_QUALITY,
		);
	return canvas;
}

const SCENE_SAMPLE_JPEG_QUALITY = 0.94;

if (window.origin === "null") {
	globalThis.__hfCaptureElement = captureSceneElement;
}

async function captureExportFrame(width, height, scale) {
	if (captureMode === "dom") {
		try {
			return await captureCompositionDom(width, height, scale);
		} catch (error) {
			captureMode = "html2canvas";
			console.warn("[HyperFrames export] DOM capture failed; using html2canvas.", error);
		}
	}
	return captureCompositionCanvas(await loadHtml2Canvas(), width, height, scale);
}

/** Images loaded from URLs an SVG image cannot fetch become data URLs, once per export. */
async function inlineImagesForCapture() {
	const jobs = [];
	for (const img of document.querySelectorAll("img[src]")) {
		const src = img.getAttribute("src") || "";
		if (!src || src.startsWith("data:")) continue;
		jobs.push(
			fetch(img.currentSrc || src)
				.then((response) => (response.ok ? response.blob() : null))
				.then(
					(blob) =>
						blob &&
						new Promise((resolve) => {
							const reader = new FileReader();
							reader.onload = () => {
								img.setAttribute("src", String(reader.result));
								resolve();
							};
							reader.onerror = () => resolve();
							reader.readAsDataURL(blob);
						}),
				)
				.catch(() => undefined),
		);
	}
	await Promise.all(jobs);
	await waitForImagesReady(document);
}

/** One animation frame, or a short timeout when the page is hidden and frames stop. */
function nextPaint(timeoutMs = 50) {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		requestAnimationFrame(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

async function waitForSeekCompletion() {
	try {
		await window.__hfWaitForSeekCompletion?.();
	} catch {
		// Best effort: the runtime may not expose the hook.
	}
	try {
		await window.__hf?.colorGrading?.waitForActiveLuts?.();
	} catch {
		// Best effort as well.
	}
}

function hasPendingImages() {
	for (const img of document.images) {
		if (!img.complete) return true;
	}
	return false;
}

async function prepareExportFrame(timestamp) {
	seekComposition(timestamp);
	await waitForSeekCompletion();
	if (captureMode === "dom") {
		// GSAP's seek is synchronous; one frame lets canvases and shaders that
		// draw on the next frame catch up.
		await nextPaint();
		if (hasPendingImages()) await waitForImagesReady(document);
		const { width, height } = getCompositionDimensions();
		await waitForShaderTextures(timestamp, width, height);
		return;
	}
	await nextPaint();
	await waitForFontsReady();
	await waitForImagesReady(document);
	await nextPaint();
}

// HyperShader loads a transition's textures shortly before playback reaches
// it and hides its canvas until they are in; an export runs ahead of that.
// The windows come from HyperShader.init's config (recorded below), and the
// first frame of each waits once for the shader canvas.
const shaderTransitionWindows = [];
const SHADER_TEXTURE_WAIT_MS = 3000;

function watchHyperShaderTransitions() {
	const shader = window.HyperShader;
	if (!shader || typeof shader.init !== "function" || shader.__memorallWatched) {
		return;
	}
	const init = shader.init;
	// The global is a bundle namespace with getter-only exports: replace it.
	window.HyperShader = {
		...shader,
		__memorallWatched: true,
		init(config, ...rest) {
			for (const transition of config?.transitions ?? []) {
				const start = Number(transition?.time);
				const duration = Number(transition?.duration ?? 0.7);
				if (Number.isFinite(start) && Number.isFinite(duration) && duration > 0) {
					shaderTransitionWindows.push({ start, end: start + duration, warmed: false });
				}
			}
			return init.call(shader, config, ...rest);
		},
	};
}

async function waitForShaderTextures(timestamp, width, height) {
	const window_ = shaderTransitionWindows.find(
		(candidate) =>
			!candidate.warmed && timestamp >= candidate.start && timestamp < candidate.end,
	);
	if (!window_) return;
	window_.warmed = true;
	const started = Date.now();
	while (Date.now() - started < SHADER_TEXTURE_WAIT_MS) {
		if (overlayCanvases(width, height).length > 0) return;
		await nextPaint();
		seekComposition(timestamp);
		await waitForSeekCompletion();
	}
}

/** HyperShader samples its transitions after load; frames taken before then lack them. */
async function waitForShaderTransitions(onWait) {
	const pending = () =>
		Object.values(window.__hf?.shaderTransitions ?? {}).filter(
			(state) => state && (!state.ready || state.loading),
		);
	const start = Date.now();
	while (pending().length > 0 && Date.now() - start < SHADER_READY_TIMEOUT_MS) {
		onWait?.();
		if (exportCancelled) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
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

	// The root's data-duration is the render length (HyperFrames 0.8); the
	// timeline's own length only counts when the root declares none.
	const authoredDuration = parseFloat(
		getRootComposition()?.getAttribute("data-duration") || "",
	);
	if (Number.isFinite(authoredDuration) && authoredDuration > 0) {
		return authoredDuration;
	}

	const timelineDuration = getRootTimeline()?.duration?.();
	if (Number.isFinite(timelineDuration) && timelineDuration > 0) {
		return timelineDuration;
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
		// `exact`: without it the runtime snaps to a 30 fps grid, which makes
		// 24, 25 and 60 fps exports repeat or skip frames.
		player.renderSeek(time, { exact: true });
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
	if (typeof window.__hfStartupError === "string" && window.__hfStartupError) {
		throw new Error(window.__hfStartupError);
	}
	// The runtime flips __renderReady once timelines are bound; older
	// runtimes never set it, so only a building flag holds export back.
	if (window.__hfTimelinesBuilding) return false;
	return getDuration() > 0 && Boolean(window.__player || getRootTimeline());
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
	exportCancelled = false;
	try {
		postExportStatus({ status: "preparing" });
		const result = await exportMp4({
			filenameBase,
			options,
			onProgress: (frame, total) =>
				postExportStatus({ status: "exporting", frame, total }),
		});
		if (!result) {
			postExportStatus({ status: "cancelled" });
			return;
		}
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
		exportCancelled = false;
	}
}

/** Renders the composition frame by frame into an MP4; null when cancelled. */
async function exportMp4({ filenameBase, options, onProgress }) {
	await pollUntil(hasExportRuntime, 20000);
	await waitForShaderTransitions();
	if (exportCancelled) return null;

	const mediabunny = await loadMediabunny();
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
		encodedFontStyle = null;
		for (const transition of shaderTransitionWindows) transition.warmed = false;
		await waitForFontsReady();
		await inlineImagesForCapture();
		await prepareExportFrame(0);
		reportUndersizedImagesForExport();

		for (let i = 0; i < totalFrames; i++) {
			if (exportCancelled) {
				await output.cancel?.();
				return null;
			}
			const timestamp = i * frameDuration;
			await prepareExportFrame(timestamp);

			const frameCanvas = await captureExportFrame(
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
		seekComposition(0);
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

	// The loading page's inline styles would beat the composition's own
	// html/body rules (a background there rendered black). Its defaults move
	// to a zero-specificity sheet instead.
	document.documentElement.removeAttribute("style");
	document.body.removeAttribute("style");
	for (const a of Array.from(compDoc.documentElement.attributes))
		document.documentElement.setAttribute(a.name, a.value);
	for (const a of Array.from(compDoc.body.attributes))
		document.body.setAttribute(a.name, a.value);

	const charsetMeta = document.head.querySelector("meta[charset]");
	document.head.innerHTML = "";
	if (charsetMeta) document.head.appendChild(charsetMeta);
	const base = document.createElement("style");
	base.setAttribute("data-hf-runner-base", "");
	base.textContent = PAGE_BASE_CSS;
	document.head.appendChild(base);
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

	// Step 1: Tailwind v4 browser compiler, with its preflight (every existing
	// composition was laid out with it) and the hf-* theme.
	await loadTailwindRuntime();
	await waitForTailwindReady();

	// Step 2: GSAP, shader-transitions, Lucide, D3, Three: fetched side by
	// side, run in order.
	await Promise.all([
		loadExternalInOrder([...managedScripts.external, ...unmanagedSrcs]),
		managedScripts.three ? loadThree() : null,
	]);

	watchHyperShaderTransitions();

	// Step 3: replace simple Lucide placeholders before animations target them.
	renderLucideIcons();

	// Step 4: inline animation — sets window.__timelines["main"] = tl. The
	// registry exists first: HyperFrames' own templates assume the runtime
	// created it.
	window.__timelines = window.__timelines || {};
	for (const code of scripts) runInline(code);

	// Step 5: hyperframe.runtime — go() now finds __timelines populated
	for (const src of managedScripts.runtime) await loadExternal(src);
	currentFilenameBase = options.filenameBase || currentFilenameBase;
	postExportStatus({ status: "idle" });
}

// For export QA harnesses (tools/hyperframes-export-parity-qa.mjs and
// benchmarks), which drive frames directly. Compositions never use it.
window.__hyperframesRunner = {
	seekComposition,
	prepareExportFrame,
	captureExportFrame,
	getCompositionDimensions,
	withCompositionExportViewport,
	getDuration,
};
