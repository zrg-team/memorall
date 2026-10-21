/** The bundler rewrites standalone.html to options/index.html in production. */
export function extensionAppUrl(route?: string): string {
	const manifest = chrome.runtime.getManifest();
	const page = manifest.options_ui?.page ?? manifest.options_page;
	if (!page) throw new Error("The extension has no configured app page.");
	const url = new URL(chrome.runtime.getURL(page));
	if (route) url.hash = route;
	return url.href;
}
