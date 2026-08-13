/**
 * renderer-utils.js — injected into the rewritten Vite/Next/Express HTML by
 * renderer.js BEFORE the base-href override.
 *
 * Two responsibilities:
 *
 * 1. React Refresh no-op stubs — the ViteDevServer transforms JSX with HMR
 *    calls ($RefreshReg$, $RefreshSig$, etc.). The HMR inline <script> blocks
 *    that normally set these globals are blocked by the extension CSP
 *    (no 'unsafe-inline'). We provide safe no-ops so the app loads without HMR
 *    but still renders correctly.
 *
 * 2. Ready signal — after the page's load event (all modules fetched) plus a
 *    2 s grace period for React to mount, postMessage the rendered outerHTML
 *    to the parent frame (the offscreen document's renderViaIframe).
 *    The renderId is read from window._memorallRenderId (saved by renderer.js
 *    before document.open) with window.name as fallback.
 */

// ─── SW relay re-registration ────────────────────────────────────────────────
// document.open() (called by renderer.js) removes ALL window event listeners
// (per spec). This means the sw-relay-response listener and port.onmessage set
// up in renderer.js are both gone by the time this script runs. Re-register both
// here (synchronously, before any module scripts start) so the full relay path
// is restored: SW → port1.onmessage → parent.postMessage(sw-relay-request) →
// outer page handleSwRequest → iframe.postMessage(sw-relay-response) →
// window.message → port1.postMessage(response) → SW port2.
console.log('[renderer-utils] loaded. _swRelayPort=', window._swRelayPort, '_swRelayFn=', window._swRelayFn, '_memorallRenderId=', window._memorallRenderId);
if (typeof window._memorallInstallFsReloadListener === 'function') {
	window._memorallInstallFsReloadListener();
}
if (window._swRelayPort && window._swRelayFn) {
	// Restore port1 → parent relay (SW request path).
	window._swRelayPort.onmessage = window._swRelayFn;
	console.log('[renderer-utils] re-registered port.onmessage');

	// Restore parent → port1 relay (SW response path).
	// This window.addEventListener was removed by document.open().
	window.addEventListener('message', (e) => {
		if (e.data?.type === 'sw-relay-response' && window._swRelayPort) {
			console.log('[renderer-utils] sw-relay-response id=' + e.data.id + ' forwarding to SW port');
			window._swRelayPort.postMessage({
				type: 'response',
				id: e.data.id,
				data: e.data.data,
				error: e.data.error,
			});
		}
	});
	console.log('[renderer-utils] re-registered sw-relay-response window listener');
} else {
	console.warn('[renderer-utils] could not re-register — _swRelayPort or _swRelayFn missing');
}

// ─── React Refresh stubs ─────────────────────────────────────────────────────
if (!window.$RefreshRuntime$) {
	window.$RefreshRuntime$ = {
		injectIntoGlobalHook: () => {},
		register: () => {},
		performReactRefresh: () => {},
	};
}
if (!window.$RefreshReg$) {
	window.$RefreshReg$ = () => {};
}
if (!window.$RefreshSig$) {
	window.$RefreshSig$ = () => (type) => type;
}
if (window.$RefreshRegCount$ === undefined) {
	window.$RefreshRegCount$ = 0;
}

// ─── Vite HMR context stub ────────────────────────────────────────────────────
// The AlmostNode Vite server injects an inline <script> that defines
// window.__vite_hot_context__, which transformed modules call as:
//   import.meta.hot = window.__vite_hot_context__('/src/main.jsx')
// That inline script is blocked by the extension CSP (no 'unsafe-inline').
// Without this function, any HMR-transformed module throws TypeError on load,
// preventing React from mounting. Provide a no-op stub so modules load cleanly.
if (!window.__vite_hot_context__) {
	window.__vite_hot_context__ = (_ownerPath) => ({
		data: {},
		accept: () => {},
		acceptExports: () => {},
		dispose: () => {},
		decline: () => {},
		invalidate: () => {},
		prune: () => {},
		on: () => {},
		off: () => {},
		send: () => {},
	});
}

// ─── Ready signal ─────────────────────────────────────────────────────────────
// window._memorallRenderId is saved by renderer.js before document.open() as a
// safeguard — Chrome may reset window.name when the document is replaced.
const _getRenderId = () => window._memorallRenderId ?? window.name;

const _sendReady = () => {
	parent.postMessage(
		{
			type: 'virtual-renderer-ready',
			renderId: _getRenderId(),
			html: document.documentElement.outerHTML,
		},
		'*',
	);
};

// After all module scripts finish loading, wait 2 s for React to mount then signal.
// The outer renderViaIframe timeout is the only safety net — do NOT add a hard
// fallback timer here, as it would fire before slow Vite first-builds complete
// and cancel the still-loading main.jsx fetch via iframe.remove().
window.addEventListener('load', () => setTimeout(_sendReady, 2000));
