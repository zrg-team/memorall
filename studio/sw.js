/**
 * Memorall Studio service worker.
 *
 * `BUILD_ID` and `PRECACHE` are rewritten by the Web build (see
 * apps/web/vite.config.ts) with the hashed entry assets of the bundle that is
 * being deployed. Because the build id changes whenever the bundle does, the
 * browser sees a byte-different worker on every deploy and runs the standard
 * install/waiting handshake, which is what drives the "update ready" prompt in
 * the right panel.
 *
 * Everything lives in one build-scoped cache. A new deploy therefore starts
 * from an empty cache and re-fetches what it needs, which costs a little
 * bandwidth on the first load after a release but means a stale asset can never
 * be paired with a newer shell.
 */

const BUILD_ID = "7398e54d0c0f4c0c";
const PRECACHE = [
	"index.html",
	"manifest.webmanifest",
	"icons/favicon.ico",
	"icons/favicon-16x16.png",
	"icons/favicon-32x32.png",
	"icons/apple-touch-icon.png",
	"icons/android-chrome-192x192.png",
	"icons/android-chrome-512x512.png",
	"assets/AgentCursor-DeC3kWa8.js",
	"assets/AppIcon-CkSH8qDD.js",
	"assets/ArtifactActionsMenu-BxgIHseE.js",
	"assets/D3KnowledgeGraph-Bk3L8SlV.js",
	"assets/DocumentSaveFolderDialog-Dxi7J6G_.js",
	"assets/MarkdownMessage-DBCoaTM2.js",
	"assets/MarkdownMessageBody-BbhaHfJo.js",
	"assets/MasterKeySetupDialog-Dgy2VrzT.js",
	"assets/ThemeContext-BekbPgJJ.js",
	"assets/UrlArtifact-BUSSjkDx.js",
	"assets/__vite-browser-external-DpH90L5b.js",
	"assets/agent-screen-content-le4-72il.js",
	"assets/alert-iM2o0lrG.js",
	"assets/array-BifhSqXX.js",
	"assets/arrow-left-DwsZL7rA.js",
	"assets/arrow-right-BG_ssuwf.js",
	"assets/artifact-protocol-CZaa25rz.js",
	"assets/background-job-BMnpq5Q-.js",
	"assets/badge-DZrdGxk5.js",
	"assets/band-DZ4Jagyz.js",
	"assets/brain-DsJb2ni5.js",
	"assets/bundle-mjs-DxdGK6Xj.js",
	"assets/button-BEkTpc2p.js",
	"assets/card-zXbOiDJy.js",
	"assets/ccount-DoVE7z9v.js",
	"assets/character-entities-legacy-Wut6vMuj.js",
	"assets/chat-CRBspE4C.js",
	"assets/chat-service-rF1SL3am.js",
	"assets/check-CW-MTPj0.js",
	"assets/chevron-left-D05fwA7x.js",
	"assets/chevron-right-B62NHsVt.js",
	"assets/chunk-62JRHF6Z-DqWEmBEk.js",
	"assets/circle-alert-A9XfxqYm.js",
	"assets/circle-check-big-Dg4g3zLx.js",
	"assets/circle-x-CKt8h6ag.js",
	"assets/clock-CmmVJ4uK.js",
	"assets/clsx-CcGmx7wl.js",
	"assets/collapsible-BJExUZ-g.js",
	"assets/conditions-D7uS89SQ.js",
	"assets/createLucideIcon-DMZCQHJW.js",
	"assets/cron-jobs-CRGkTNKT.js",
	"assets/database-CfoAvqET.js",
	"assets/dayjs.min-QUnUIOl1.js",
	"assets/default-skills-C4Z7aH1x.js",
	"assets/defaultLocale-BFoDCU3G.js",
	"assets/defineProperty-CHyAdSol.js",
	"assets/dialog-CbGsL-ZN.js",
	"assets/dist-BUrLPJsC.js",
	"assets/dist-CXRKIAnN.js",
	"assets/dist-CoGT0BnC.js",
	"assets/dist-CrSVNxIK.js",
	"assets/dist-CwCirKoE.js",
	"assets/dist-VBIrKDx5.js",
	"assets/dist-vjgW0k02.js",
	"assets/document-filesystem-BaYV-0iY.js",
	"assets/dom-mN4BiS2D.js",
	"assets/download-BcChea_-.js",
	"assets/drag-BFhfgHfw.js",
	"assets/dropdown-menu-N7zPoMAr.js",
	"assets/editors-DUwC_zEw.js",
	"assets/embedding-size-config-DvT4jTPc.js",
	"assets/excel-extraction-g2tMhrlq.js",
	"assets/extends-Dm11o_6n.js",
	"assets/external-link-Bphsk6hl.js",
	"assets/eye-9UCA9_q2.js",
	"assets/file-text-C5C8G7GJ.js",
	"assets/folder-CZ24YTcj.js",
	"assets/globe-ikhf3lH9.js",
	"assets/graduation-cap-CNkC2Egw.js",
	"assets/hard-drive-ChMxSN3p.js",
	"assets/image-ttjf3aCq.js",
	"assets/index-BNhjMeD4.js",
	"assets/index-CNr3eJRW.css",
	"assets/info-iRNzpaxE.js",
	"assets/init-ZlXS9mIS.js",
	"assets/input-Bpw7FW3W.js",
	"assets/jsx-runtime-CKeovgl0.js",
	"assets/label-CODDqc3Q.js",
	"assets/languages-iTpjE4Sy.js",
	"assets/lib-8Vs_bKlt.js",
	"assets/lib-CHBxiIy0.js",
	"assets/lib-CkT3jz7Z.js",
	"assets/line-CJgFmzQz.js",
	"assets/linear-n_-xUt1C.js",
	"assets/link-2-UZfq4_wN.js",
	"assets/llm-service-core-xu9FcdfW.js",
	"assets/llm-service-main-BFl0vsi4.js",
	"assets/llm-service-proxy-CDuQrjz1.js",
	"assets/loader-circle-0XOAVn3S.js",
	"assets/logger-BUo2gG75.js",
	"assets/marked.esm-CCiCWKfQ.js",
	"assets/master-key-CrxdAZjc.js",
	"assets/mcp-connections-cBYdM1Rw.js",
	"assets/network-Bw0upedK.js",
	"assets/noop-hsY0y0AT.js",
	"assets/one-light-p4wqb6CT.js",
	"assets/ordinal-CPleeUAT.js",
	"assets/panel-left-open-BxEgxR3v.js",
	"assets/path-fybaL0A-.js",
	"assets/pencil-CGP8x8tm.js",
	"assets/play-DEP7_sNT.js",
	"assets/plug-BSGFcex8.js",
	"assets/plus-D5rwj7xC.js",
	"assets/preload-helper-DFT2dvf2.js",
	"assets/progress-DZZ710Ba.js",
	"assets/react-Dlsnd8OS.js",
	"assets/refresh-cw-DhSt5CM_.js",
	"assets/rolldown-runtime-C0FnF6B9.js",
	"assets/sandbox-container-service-main-DrXSVEon.js",
	"assets/sandbox-container-service-proxy-BxT3T15k.js",
	"assets/save-BhPneH_G.js",
	"assets/schema-DpSduDpW.js",
	"assets/search-DLg36TUl.js",
	"assets/select-C6UG1jWa.js",
	"assets/send-DrEWd7ll.js",
	"assets/services-Cpgqd42a.js",
	"assets/settings-2-CIn2PmkD.js",
	"assets/sliders-horizontal-Cx3Z331x.js",
	"assets/space-separated-tokens-IYdMUOZ2.js",
	"assets/sparkles-DeGlq326.js",
	"assets/square-B4ozNfHR.js",
	"assets/src-CjmJ-r2n.js",
	"assets/src-dyww4Ujz.js",
	"assets/sw-response-utils-BOezRMTS.js",
	"assets/tabs-BxUq-MhV.js",
	"assets/target-BNfgeDij.js",
	"assets/terminal-BCJiSo2n.js",
	"assets/textarea-DWUQj7cv.js",
	"assets/thread-history-search-vector-B_NWWCjC.js",
	"assets/time-Bx-Iljkj.js",
	"assets/tooltip-YFUAMfm7.js",
	"assets/topic-service-CnR-YOpa.js",
	"assets/trash-2-Cmhy9D-K.js",
	"assets/triangle-alert-CWnhAm5r.js",
	"assets/typeof-B5XbjTb1.js",
	"assets/unsupportedIterableToArray-7m2_meZB.js",
	"assets/use-current-model-BkuucrAt.js",
	"assets/use-magic-model-download-Dz9BhZ39.js",
	"assets/useTranslation-CxlMNMIB.js",
	"assets/value-yWrSs7IY.js",
	"assets/walk-CvnvACZy.js",
	"assets/web-CXoWV8Wt.js",
	"assets/web-browser-service-main-D_LYtU2R.js",
	"assets/web-browser-service-proxy-D5EYoiWT.js",
	"assets/webgpu-CfPPmZ6v.js",
	"assets/with-selector-DNYX53gf.js",
	"assets/x-B6u8tIyA.js",
	"assets/zap-BaHGONi8.js"
];

const CACHE_PREFIX = "memorall-studio-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const ROOT = new URL("./", self.location.href);
const SHELL_URL = new URL("index.html", ROOT).href;

// The sandbox registers its own worker at ./sandbox/ that synthesises virtual
// server responses, so the shell must never answer for those paths.
const BYPASS_PREFIXES = ["sandbox/"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await cache.addAll(PRECACHE.map((path) => new URL(path, ROOT).href));
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
					.map((key) => caches.delete(key)),
			);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("message", (event) => {
	const type = event.data && event.data.type;
	if (type === "MEMORALL_SKIP_WAITING") {
		self.skipWaiting();
		return;
	}
	if (type === "MEMORALL_WARM_CACHE") {
		event.waitUntil(warmCache(event.data.urls));
		return;
	}
	if (type === "MEMORALL_BUILD_ID") {
		event.source?.postMessage({ type: "MEMORALL_BUILD_ID", buildId: BUILD_ID });
	}
});

/**
 * On the very first visit this worker only starts controlling the page part way
 * through boot, so the chunks imported before that never pass through `fetch`
 * and would be missing the first time the app is opened offline. The page
 * reports what it has loaded and they are pulled in here.
 */
async function warmCache(urls) {
	if (!Array.isArray(urls)) return;
	const cache = await caches.open(CACHE_NAME);
	await Promise.all(
		urls.map(async (candidate) => {
			try {
				const url = new URL(candidate, ROOT);
				if (url.origin !== self.location.origin) return;
				if (!url.pathname.startsWith(ROOT.pathname)) return;
				const relativePath = url.pathname.slice(ROOT.pathname.length);
				if (BYPASS_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
					return;
				}
				if (await cache.match(url.href)) return;
				const response = await fetch(url.href);
				if (response.status === 200 && response.type === "basic") {
					await cache.put(url.href, response);
				}
			} catch {
				// A warm-up miss just means that asset is fetched on demand later.
			}
		}),
	);
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	// Range requests answer with 206, which must never enter the cache.
	if (request.headers.has("range")) return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (!url.pathname.startsWith(ROOT.pathname)) return;

	const relativePath = url.pathname.slice(ROOT.pathname.length);
	if (BYPASS_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return;

	// Only the app document may fall back to the shell. The runner and viewer
	// iframes below this scope are navigations too, and answering those with the
	// shell would boot a second copy of the app inside them.
	const isShellDocument = relativePath === "" || relativePath === "index.html";

	event.respondWith(
		request.mode === "navigate"
			? serveDocument(request, isShellDocument)
			: serveAsset(request),
	);
});

/**
 * Documents are served network-first so a reload after a deploy always picks up
 * the new HTML, and fall back to the cached copy when the network is gone. The
 * app itself routes on the hash, so one cached shell covers every route.
 */
async function serveDocument(request, isShellDocument) {
	const cache = await caches.open(CACHE_NAME);
	try {
		const response = await fetch(request);
		if (response.ok) void cache.put(request, response.clone());
		return response;
	} catch {
		const cached =
			(await cache.match(request)) ??
			(isShellDocument ? await cache.match(SHELL_URL) : undefined);
		return cached ?? Response.error();
	}
}

/**
 * Assets are cache-first: the bundle is content-hashed, and the vendored
 * runtimes below it are pinned by the same build, so whatever is in this
 * build's cache is by definition the right version.
 */
async function serveAsset(request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (response.status === 200 && response.type === "basic") {
			void cache.put(request, response.clone());
		}
		return response;
	} catch {
		// Offline, or the page aborted the request while it was in flight. A
		// network error response leaves that indistinguishable from a fetch this
		// worker never intercepted; rethrowing would log a worker failure instead.
		return Response.error();
	}
}
