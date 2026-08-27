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

const BUILD_ID = "__MEMORALL_BUILD_ID__";
const PRECACHE = __MEMORALL_PRECACHE__;

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
