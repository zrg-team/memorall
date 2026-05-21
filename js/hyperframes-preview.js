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

		renderComposition(msg.html, inlineScripts).catch(console.error);
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

function runInline(code) {
	if (!code || !code.trim()) return;
	const s = document.createElement("script");
	s.textContent = code;
	document.body.appendChild(s);
}

// ── Main render ───────────────────────────────────────────────────────────────

async function renderComposition(html, inlineScripts) {
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
}
