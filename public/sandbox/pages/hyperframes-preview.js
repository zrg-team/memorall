// HyperFrames sandbox preview page.
//
// LOAD ORDER (guaranteed):
//   1. GSAP + shader-transitions  — external <script src>
//   2. inline animation script    — sets window.__timelines["main"] = tl
//   3. hyperframe.runtime         — go() reads __timelines immediately on load
//
// WHY THE RUNTIME MUST BE LAST:
//   When document.readyState === "complete" the runtime calls go() synchronously
//   on its own onload event.  go() reads window.__timelines ONCE.  Loading the
//   runtime after the animation script is the only way go() can find the
//   populated timeline and drive GSAP from() tweens.
//
// HOW THE INLINE SCRIPT IS DELIVERED (two paths, either one is enough):
//   A. message.inlineScripts  — string[] sent by the updated TS component
//   B. regex extraction from message.html  — fallback for older compiled builds
//      Uses the raw HTML string so it is never broken by DOMParser round-trips.

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

		// Path A: scripts sent separately by the TS component (primary).
		// Path B: regex extraction from the raw HTML string (fallback).
		const inlineScripts = Array.isArray(msg.inlineScripts) ? msg.inlineScripts : [];

		renderComposition(msg.html, inlineScripts).catch(console.error);
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Regex used to pull animation scripts out of the raw HTML string.
// Same pattern used by extractAuthoredInlineScripts in the TS component.
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

	// Root / body attributes (lang, style, etc.)
	for (const a of Array.from(compDoc.documentElement.attributes))
		document.documentElement.setAttribute(a.name, a.value);
	for (const a of Array.from(compDoc.body.attributes))
		document.body.setAttribute(a.name, a.value);

	// Rebuild <head> without scripts
	const charsetMeta = document.head.querySelector("meta[charset]");
	document.head.innerHTML = "";
	if (charsetMeta) document.head.appendChild(charsetMeta);
	for (const el of Array.from(compDoc.head.children)) {
		if (el.tagName !== "SCRIPT") document.head.appendChild(el.cloneNode(true));
	}

	// Set body to scene HTML only (scripts removed)
	const bodyClone = compDoc.body.cloneNode(true);
	for (const s of Array.from(bodyClone.querySelectorAll("script"))) s.remove();
	document.body.innerHTML = "";
	while (bodyClone.firstChild) document.body.appendChild(bodyClone.firstChild);

	// Split external scripts: runtime deferred to last
	const RUNTIME_RE = /hyperframe\.runtime/i;
	const extSrcs = [
		...Array.from(compDoc.head.querySelectorAll("script[src]")),
		...Array.from(compDoc.body.querySelectorAll("script[src]")),
	].map((s) => s.getAttribute("src")).filter(Boolean);

	const runtimeSrcs = extSrcs.filter((s) => RUNTIME_RE.test(s));
	const otherSrcs = extSrcs.filter((s) => !RUNTIME_RE.test(s));

	// Resolve the inline animation scripts to execute.
	// Prefer the array from message.inlineScripts (path A).
	// Fall back to regex on the raw HTML string (path B) — this works even when
	// the TS component build is stale, because it does not rely on DOMParser.
	const scripts =
		inlineScripts.length > 0 ? inlineScripts : extractFromHtml(html);

	// ── LOAD ORDER ────────────────────────────────────────────────────────────
	// Step 1: GSAP, shader-transitions (dependencies for the animation script)
	for (const src of otherSrcs) await loadExternal(src);

	// Step 2: inline animation script — sets window.__timelines["main"] = tl
	for (const code of scripts) runInline(code);

	// Step 3: hyperframe.runtime — go() now finds __timelines already populated
	for (const src of runtimeSrcs) await loadExternal(src);
}
