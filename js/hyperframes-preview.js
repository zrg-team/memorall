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
//   1. GSAP + shader-transitions  — external CDN scripts
//   2. inline animation script    — sets window.__timelines["main"] = tl
//   3. hyperframe.runtime         — go() reads __timelines on load

const DEFAULT_EXPORT_FPS = 30;
const MEDIABUNNY_ESM_URL =
	"https://cdn.jsdelivr.net/npm/mediabunny@1.45.2/+esm";

// ── CDN fallback map for extension-local script URLs ─────────────────────────
// Mirrors the CDN_TO_LOCAL map in composition-preprocessor.ts (reversed).
const CDN_MAP = {
	"gsap.min.js":
		"https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
	"hyperframe.runtime.iife.js":
		"https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js",
	"shader-transitions.global.js":
		"https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js",
	"html2canvas.min.js":
		"https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
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
		if (
			msg?.type !== "memorall:hyperframes-composition" ||
			msg.key !== key ||
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

		renderComposition(msg.html, inlineScripts, { filenameBase }).catch(
			console.error,
		);
	});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
const ANIMATION_PAT =
	/(?:window\.__timelines|__timelines\s*=|gsap\.timeline|HyperShader\.init)/;

function extractFromHtml(html) {
	const out = [];
	for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
		const code = (m[1] || "").trim();
		if (code && ANIMATION_PAT.test(code)) out.push(code);
	}
	return out;
}

function loadExternal(src) {
	return new Promise((resolve) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = resolve;
		s.onerror = resolve;
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
	html2CanvasLoad ??= loadScriptOnce(CDN_MAP["html2canvas.min.js"], () => {
		return typeof window.html2canvas === "function";
	});
	return html2CanvasLoad.then(() => window.html2canvas);
}

function loadMediabunny() {
	mediabunnyLoad ??= import(MEDIABUNNY_ESM_URL);
	return mediabunnyLoad;
}

function runInline(code) {
	if (!code || !code.trim()) return;
	const s = document.createElement("script");
	s.textContent = code;
	document.body.appendChild(s);
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

function injectExportStyles() {
	const style = document.createElement("style");
	style.textContent = `
.hf-export-control {
	position: fixed;
	top: 16px;
	right: 16px;
	z-index: 2147483647;
	font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.hf-export-button {
	min-width: 132px;
	height: 38px;
	border: 1px solid rgba(255,255,255,0.22);
	border-radius: 8px;
	background: rgba(12,12,16,0.82);
	color: #fff;
	box-shadow: 0 10px 30px rgba(0,0,0,0.28);
	backdrop-filter: blur(12px);
	font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	cursor: pointer;
}
.hf-export-button:hover:not(:disabled) {
	background: rgba(28,28,34,0.9);
}
.hf-export-button:disabled {
	cursor: progress;
	opacity: 0.78;
}
`;
	document.head.appendChild(style);
}

function mountExportButton(options = {}) {
	injectExportStyles();

	const control = document.createElement("div");
	control.className = "hf-export-control";
	control.setAttribute("data-html2canvas-ignore", "true");

	const button = document.createElement("button");
	button.type = "button";
	button.className = "hf-export-button";
	button.textContent = "Download MP4";
	control.appendChild(button);
	document.body.appendChild(control);

	const setButton = (label, disabled = false) => {
		button.textContent = label;
		button.disabled = disabled;
	};

	button.addEventListener("click", async () => {
		try {
			setButton("Preparing...", true);
			await exportMp4({
				filenameBase: options.filenameBase || "hyperframes-composition",
				onProgress: (frame, total) =>
					setButton(`Exporting ${frame}/${total}`, true),
			});
			setButton("Downloaded", false);
			setTimeout(() => setButton("Download MP4", false), 3000);
		} catch (error) {
			console.error(error);
			setButton("Export failed", false);
			setTimeout(() => setButton("Download MP4", false), 4000);
		}
	});
}

async function exportMp4({ filenameBase, onProgress }) {
	await pollUntil(hasExportRuntime, 20000);

	const [html2canvas, mediabunny] = await Promise.all([
		loadHtml2Canvas(),
		loadMediabunny(),
	]);
	const {
		Output,
		Mp4OutputFormat,
		BufferTarget,
		CanvasSource,
		QUALITY_HIGH,
	} = mediabunny;

	const { width, height } = getCompositionDimensions();
	const duration = getDuration();
	if (!duration || duration <= 0) {
		throw new Error("Could not read composition duration");
	}

	const captureCanvas = document.createElement("canvas");
	captureCanvas.width = width;
	captureCanvas.height = height;
	const ctx = captureCanvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Could not create capture canvas");

	const bufferTarget = new BufferTarget();
	const videoSource = new CanvasSource(captureCanvas, {
		codec: "avc",
		bitrate: QUALITY_HIGH,
		keyFrameInterval: 2,
	});
	const output = new Output({
		format: new Mp4OutputFormat(),
		target: bufferTarget,
	});
	output.addVideoTrack(videoSource);
	await output.start();

	const totalFrames = Math.ceil(duration * DEFAULT_EXPORT_FPS);
	const frameDuration = 1 / DEFAULT_EXPORT_FPS;

	for (let i = 0; i < totalFrames; i++) {
		const timestamp = i * frameDuration;
		seekComposition(timestamp);
		await waitForRaf();

		const frameCanvas = await html2canvas(document.body, {
			useCORS: true,
			allowTaint: false,
			scale: 1,
			width,
			height,
			scrollX: 0,
			scrollY: 0,
			x: 0,
			y: 0,
			ignoreElements: (el) =>
				el.hasAttribute("data-html2canvas-ignore") ||
				Boolean(el.closest?.("[data-html2canvas-ignore]")),
		});

		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(frameCanvas, 0, 0, width, height);
		await videoSource.add(timestamp, frameDuration);
		onProgress?.(i + 1, totalFrames);
	}

	videoSource.close();
	await output.finalize();

	const buffer = bufferTarget.buffer;
	if (!buffer) throw new Error("No MP4 buffer produced");

	const blob = new Blob([buffer], { type: "video/mp4" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${sanitizeFilename(filenameBase)}.mp4`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30000);
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

	// Collect all external script srcs, converting chrome-extension:// to CDN.
	const RUNTIME_RE = /hyperframe\.runtime/i;
	const rawSrcs = [
		...Array.from(compDoc.head.querySelectorAll("script[src]")),
		...Array.from(compDoc.body.querySelectorAll("script[src]")),
	]
		.map((s) => s.getAttribute("src"))
		.map(resolveSrc)
		.filter(Boolean);

	const runtimeSrcs = rawSrcs.filter((s) => RUNTIME_RE.test(s));
	const otherSrcs = rawSrcs.filter((s) => !RUNTIME_RE.test(s));

	const scripts =
		inlineScripts.length > 0 ? inlineScripts : extractFromHtml(html);

	// Step 1: GSAP, shader-transitions
	for (const src of otherSrcs) await loadExternal(src);

	// Step 2: inline animation — sets window.__timelines["main"] = tl
	for (const code of scripts) runInline(code);

	// Step 3: hyperframe.runtime — go() now finds __timelines populated
	for (const src of runtimeSrcs) await loadExternal(src);

	mountExportButton(options);
}
