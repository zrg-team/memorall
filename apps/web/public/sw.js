const SHELL_CACHE = "memorall-studio-shell-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.includes("/models/") || url.pathname.includes("/vendors/")) {
		return;
	}

	event.respondWith(
		fetch(event.request)
			.then((response) => {
				if (response.ok) {
					const copy = response.clone();
					void caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy));
				}
				return response;
			})
			.catch(async () => {
				return (
					(await caches.match(event.request)) ??
					(await caches.match("./index.html")) ??
					Response.error()
				);
			}),
	);
});
