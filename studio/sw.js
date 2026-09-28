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

const BUILD_ID = "2d649bba8edd4635";
const PRECACHE = [
	"index.html",
	"manifest.webmanifest",
	"icons/favicon.ico",
	"icons/favicon-16x16.png",
	"icons/favicon-32x32.png",
	"icons/apple-touch-icon.png",
	"icons/android-chrome-192x192.png",
	"icons/android-chrome-512x512.png",
	"assets/AgentCursor-ne35xGA7.js",
	"assets/AppIcon-ChZvku2b.js",
	"assets/AppSkeletons-CJKmKR8_.js",
	"assets/ArtifactActionsMenu-aBgekViZ.js",
	"assets/Combination-C0lElyt-.js",
	"assets/D3KnowledgeGraph-DUvesBl1.js",
	"assets/DocumentSaveFolderDialog-CoLuj8Ut.js",
	"assets/HubMediaModelList-DHNd1YrT.js",
	"assets/MarkdownMessage-QWoQFrIA.js",
	"assets/MarkdownMessageBody-Dla99QKE.js",
	"assets/PasskeyPromptDialog-CUg3aMlq.js",
	"assets/ThemeContext-BFHhC3jz.js",
	"assets/UrlArtifact-Cm3oRq3K.js",
	"assets/__vite-browser-external-DpH90L5b.js",
	"assets/alert-B5TmiM21.js",
	"assets/array-BifhSqXX.js",
	"assets/arrow-left-DwsZL7rA.js",
	"assets/arrow-right-BG_ssuwf.js",
	"assets/artifact-protocol-DxE45X9R.js",
	"assets/background-job-BMnpq5Q-.js",
	"assets/badge-BPN2Bx9n.js",
	"assets/band-DZ4Jagyz.js",
	"assets/brain-DsJb2ni5.js",
	"assets/bundle-mjs-DxdGK6Xj.js",
	"assets/button-BLH9JtNY.js",
	"assets/card-B_FV07oh.js",
	"assets/ccount-DoVE7z9v.js",
	"assets/character-entities-legacy-Wut6vMuj.js",
	"assets/chat-BOR5Jnnc.js",
	"assets/chat-service-CqExD_Je.js",
	"assets/check-CW-MTPj0.js",
	"assets/chevron-left-D05fwA7x.js",
	"assets/chevron-right-B62NHsVt.js",
	"assets/chunk-62JRHF6Z-DqWEmBEk.js",
	"assets/circle-alert-A9XfxqYm.js",
	"assets/circle-check-big-Dg4g3zLx.js",
	"assets/circle-question-mark-BHa-6p7m.js",
	"assets/circle-x-CKt8h6ag.js",
	"assets/clock-CmmVJ4uK.js",
	"assets/clsx-CcGmx7wl.js",
	"assets/collapsible-BXV1auoo.js",
	"assets/conditions-D7uS89SQ.js",
	"assets/constants-DbVDutCE.js",
	"assets/copy-Bj2bww0r.js",
	"assets/cpu-DE9mSb8e.js",
	"assets/createLucideIcon-DMZCQHJW.js",
	"assets/cron-jobs-BliLXfvD.js",
	"assets/database-CfoAvqET.js",
	"assets/dayjs.min-QUnUIOl1.js",
	"assets/decision-schema-Cp6CnZJO.js",
	"assets/default-skills-2A7dYM31.js",
	"assets/defaultLocale-BFoDCU3G.js",
	"assets/defineProperty-CHyAdSol.js",
	"assets/dialog-CcMqG3aW.js",
	"assets/dist-BJE7JogY.js",
	"assets/dist-Ce-92AQP.js",
	"assets/dist-D23uRRzE.js",
	"assets/dist-D7WAMNiA.js",
	"assets/dist-DCFmt3Zl.js",
	"assets/dist-EsvM5h_E.js",
	"assets/dist-fcreDOX_.js",
	"assets/dist-oedkikN_.js",
	"assets/document-filesystem-Bdjd5DYD.js",
	"assets/dom-mN4BiS2D.js",
	"assets/download-BcChea_-.js",
	"assets/drag-BFhfgHfw.js",
	"assets/dropdown-menu-dNq7NwCT.js",
	"assets/ellipsis-MXA3dxgI.js",
	"assets/embedding-size-config-DvT4jTPc.js",
	"assets/excel-extraction-g2tMhrlq.js",
	"assets/extends-C0i0KCCT.js",
	"assets/external-link-Bphsk6hl.js",
	"assets/eye-9UCA9_q2.js",
	"assets/file-text-C5C8G7GJ.js",
	"assets/folder-CZ24YTcj.js",
	"assets/folder-open-Is4lSYEU.js",
	"assets/globe-ikhf3lH9.js",
	"assets/graduation-cap-CNkC2Egw.js",
	"assets/hard-drive-ChMxSN3p.js",
	"assets/image-ttjf3aCq.js",
	"assets/index-Dbw5_Bt7.css",
	"assets/index-DwMtZeaa.js",
	"assets/info-iRNzpaxE.js",
	"assets/init-ZlXS9mIS.js",
	"assets/input-YAmHtgCa.js",
	"assets/jsx-runtime-CKeovgl0.js",
	"assets/key-round-o-AnHTwJ.js",
	"assets/label--F0dxk88.js",
	"assets/languages-iTpjE4Sy.js",
	"assets/lib-8Vs_bKlt.js",
	"assets/lib-CkT3jz7Z.js",
	"assets/lib-DxQMVGea.js",
	"assets/line-CJgFmzQz.js",
	"assets/linear-n_-xUt1C.js",
	"assets/link-2-UZfq4_wN.js",
	"assets/list-checks-CtVMj3z1.js",
	"assets/llm-runner-Bv7zjV15.js",
	"assets/llm-service-core-DZwPPKAX.js",
	"assets/llm-service-main-BPSU_CF9.js",
	"assets/llm-service-proxy-BiLuxQFQ.js",
	"assets/loader-circle-0XOAVn3S.js",
	"assets/logger-BUo2gG75.js",
	"assets/marked.esm-CCiCWKfQ.js",
	"assets/master-key-XOllQ5mk.js",
	"assets/maximize-2-BHmPhsPF.js",
	"assets/mcp-connections-BB3tXp9j.js",
	"assets/media-model-registry-DCOtC2Mq.js",
	"assets/media-model-store-CgNS4Hry.js",
	"assets/media-persistence-B9wg43OU.js",
	"assets/mic-DdLxvZx7.js",
	"assets/minimize-2-BzCRi6YN.js",
	"assets/model-category-CZSgl_Um.js",
	"assets/model-registry-CNi4gMrF.js",
	"assets/network-Bw0upedK.js",
	"assets/noop-hsY0y0AT.js",
	"assets/one-light-BlQRSXKv.js",
	"assets/ordinal-CPleeUAT.js",
	"assets/panel-left-close-BEh-3npM.js",
	"assets/path-fybaL0A-.js",
	"assets/pencil-CGP8x8tm.js",
	"assets/play-DEP7_sNT.js",
	"assets/plug-BSGFcex8.js",
	"assets/plus-D5rwj7xC.js",
	"assets/popover-5UdmYNOV.js",
	"assets/preload-helper-DFT2dvf2.js",
	"assets/progress-BXKtXP7O.js",
	"assets/prompt-input-DLUa5jwU.js",
	"assets/provider-registry-BdEvYLbY.js",
	"assets/react-Dlsnd8OS.js",
	"assets/refresh-cw-DhSt5CM_.js",
	"assets/rolldown-runtime-C0FnF6B9.js",
	"assets/rotate-ccw-FH5M-rG9.js",
	"assets/rotate-cw-CPttR-Ou.js",
	"assets/sandbox-container-service-main-75LcjL6h.js",
	"assets/sandbox-container-service-proxy-GbUHcohj.js",
	"assets/sandbox-paths-3AL-6zZi.js",
	"assets/sanitize-json-Bfn7u_zV.js",
	"assets/save-BhPneH_G.js",
	"assets/schema-D96nszmY.js",
	"assets/search-DLg36TUl.js",
	"assets/secure-session-zEuaWVZw.js",
	"assets/select-LoJ5Q0jx.js",
	"assets/selectable-model-CD5YMgan.js",
	"assets/send-DrEWd7ll.js",
	"assets/services-DOAv8pmO.js",
	"assets/settings-2-CIn2PmkD.js",
	"assets/shield-check-BzRYhfMQ.js",
	"assets/sliders-horizontal-Cx3Z331x.js",
	"assets/space-separated-tokens-IYdMUOZ2.js",
	"assets/sparkles-DeGlq326.js",
	"assets/square-B4ozNfHR.js",
	"assets/src-CjmJ-r2n.js",
	"assets/src-dyww4Ujz.js",
	"assets/studio-modes-DbjAcNER.js",
	"assets/sw-response-utils-BOezRMTS.js",
	"assets/switch-BaZUTcP6.js",
	"assets/tabs-BlrHmLib.js",
	"assets/target-BNfgeDij.js",
	"assets/terminal-BCJiSo2n.js",
	"assets/text-search-efzOw_Pd.js",
	"assets/textarea-DEbSsKwe.js",
	"assets/thread-history-search-vector-B_NWWCjC.js",
	"assets/time-Bx-Iljkj.js",
	"assets/token-usage-B9SzV5yx.js",
	"assets/tooltip-CQ4TotUY.js",
	"assets/topic-service-B_xl9S4N.js",
	"assets/trash-2-Cmhy9D-K.js",
	"assets/triangle-alert-CWnhAm5r.js",
	"assets/typeof-B5XbjTb1.js",
	"assets/unsupportedIterableToArray-7m2_meZB.js",
	"assets/use-current-model-CgV52Vnf.js",
	"assets/use-magic-model-download-ChJTHqTb.js",
	"assets/use-selectable-models-BHwX1MEE.js",
	"assets/useTranslation-CxlMNMIB.js",
	"assets/value-yWrSs7IY.js",
	"assets/walk-CvnvACZy.js",
	"assets/wand-sparkles-C9Ti64SY.js",
	"assets/web-DBq1bqNV.js",
	"assets/web-browser-service-main-D20MSUHf.js",
	"assets/web-browser-service-proxy-BU1SQ4Iw.js",
	"assets/webgpu-Cdl5hPsi.js",
	"assets/with-selector-DNYX53gf.js",
	"assets/workspace-mode-C_bsmI05.js",
	"assets/x-B6u8tIyA.js",
	"assets/zap-BaHGONi8.js",
	"runner/configs/transformer-model-configs.json",
	"runner/index.html",
	"runner/main.js",
	"runner/modes/embedding-runner.js",
	"runner/modes/media-runner.js",
	"runner/modes/media/asr.js",
	"runner/modes/media/audio-decode.js",
	"runner/modes/media/cache.js",
	"runner/modes/media/cancellation.js",
	"runner/modes/media/decision-model.js",
	"runner/modes/media/device.js",
	"runner/modes/media/engine-port.js",
	"runner/modes/media/engine.js",
	"runner/modes/media/image-encode.js",
	"runner/modes/media/image-tools.js",
	"runner/modes/media/loaders.js",
	"runner/modes/media/progress.js",
	"runner/modes/media/text-chunking.js",
	"runner/modes/media/text-tools.js",
	"runner/modes/media/transcript.js",
	"runner/modes/media/transferables.js",
	"runner/modes/media/transformers-env.js",
	"runner/modes/media/tts.js",
	"runner/modes/media/worker.js",
	"runner/modes/transformer-runner.js",
	"runner/modes/transformmers/cache.js",
	"runner/modes/transformmers/capabilities.js",
	"runner/modes/transformmers/catalog.js",
	"runner/modes/transformmers/chat-completions.js",
	"runner/modes/transformmers/constants.js",
	"runner/modes/transformmers/context-window.js",
	"runner/modes/transformmers/context.js",
	"runner/modes/transformmers/dtype.js",
	"runner/modes/transformmers/generation-utils.js",
	"runner/modes/transformmers/input-builder.js",
	"runner/modes/transformmers/model-loader.js",
	"runner/modes/transformmers/progress.js",
	"runner/modes/transformmers/responses.js",
	"runner/modes/transformmers/text-utils.js",
	"runner/modes/transformmers/transformers-env.js",
	"runner/modes/webllm-runner.js",
	"runner/modes/wllama-runner.js",
	"runner/utils/common.js",
	"runner/utils/context-planner.js",
	"runner/utils/gguf-metadata.js",
	"runner/utils/gpu-lock.js",
	"runner/utils/model-lifecycle.js",
	"runner/utils/openai-content.js"
];

const CACHE_PREFIX = "memorall-studio-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const ROOT = new URL("./", self.location.href);
const SHELL_URL = new URL("index.html", ROOT).href;

// The sandbox registers its own worker at ./sandbox/ that synthesises virtual
// server responses, so the shell must never answer for those paths.
const BYPASS_PREFIXES = ["sandbox/"];

/**
 * Pages serves everything with `max-age=600`, and the runner, sandbox and
 * vendor paths below this scope are not content-hashed. A plain fetch can
 * therefore be answered from the HTTP cache with the previous deploy's bytes,
 * and because assets are served cache-first that copy would then be pinned for
 * the whole life of this build — a fixed file staying broken long after it was
 * fixed. Always populate the cache straight from the network.
 */
function fromNetwork(input) {
	try {
		return new Request(input, { cache: "reload" });
	} catch {
		// A navigation request cannot be reconstructed; fall back to its URL.
		return new Request(
			typeof input === "string" ? input : input.url,
			{ cache: "reload" },
		);
	}
}

/**
 * Fetches without letting the HTTP cache answer, but falls back to a normal
 * fetch when that fails. `cache: "reload"` refuses to be satisfied from the
 * HTTP cache at all, which offline turns into a hard failure for anything this
 * worker has not cached yet — a normal fetch can still be answered from it.
 */
async function fetchFresh(request) {
	try {
		return await fetch(fromNetwork(request));
	} catch {
		return await fetch(request);
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			await Promise.all(
				PRECACHE.map(async (path) => {
					const url = new URL(path, ROOT).href;
					const response = await fetch(fromNetwork(url));
					if (response.status !== 200) {
						throw new Error(`Precache failed: ${path} (${response.status})`);
					}
					await cache.put(url, response);
				}),
			);
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
				const response = await fetch(fromNetwork(url.href));
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
			: serveAsset(request, relativePath),
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
		const response = await fetchFresh(request.url);
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
 * Everything under assets/ is emitted by the bundler with a content hash in its
 * name, so a cached copy can never be the wrong one and is served as-is.
 *
 * The runner, sandbox and vendor trees keep the same filenames across deploys,
 * and the build id is derived from the bundle — so a fix to one of those files
 * alone does not produce a new worker. Cache-first would pin such a file for as
 * long as this build lives, leaving an already-fixed script broken. Serve the
 * cached copy for speed, then refresh it in the background: staleness is bounded
 * to a single load, offline still works, and no request waits on the network.
 */
async function serveAsset(request, relativePath) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	if (cached) {
		if (!relativePath.startsWith("assets/")) {
			void refresh(cache, request);
		}
		return cached;
	}
	try {
		const response = await fetchFresh(request);
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

async function refresh(cache, request) {
	try {
		const response = await fetch(fromNetwork(request));
		if (response.status === 200 && response.type === "basic") {
			await cache.put(request, response);
		}
	} catch {
		// Offline: the copy already in the cache stands.
	}
}
