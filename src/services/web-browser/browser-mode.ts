import type { WebBrowserMode } from "./web-browser-protocol";

const LOOPBACK_HOSTS = new Set(["localhost", "0.0.0.0", "[::1]", "::1"]);

/**
 * A server on this machine, or a page this app serves itself (the sandbox's
 * `/__virtual__/<port>/` previews). Only these load well in an iframe: a
 * public site often refuses to be framed or keeps its DOM out of reach.
 */
export const isLocalServerUrl = (
	rawUrl: string,
	appOrigin?: string,
): boolean => {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		// A bare path such as "/__virtual__/3000/" is relative to the app.
		return rawUrl.startsWith("/");
	}
	// Not `url.origin`: a chrome-extension: URL's origin reads "null".
	if (appOrigin && `${url.protocol}//${url.host}` === appOrigin) return true;
	const host = url.hostname.toLowerCase();
	return (
		LOOPBACK_HOSTS.has(host) ||
		host.endsWith(".localhost") ||
		/^127(?:\.\d{1,3}){3}$/.test(host)
	);
};

/**
 * Where a page opens: a window, else a tab (the browser falls back on its
 * own when it cannot make a window), and an iframe only for a local server.
 * An iframe asked for on a public site becomes a window.
 */
export const resolveWebBrowserMode = (
	rawUrl: string,
	requested?: WebBrowserMode,
	appOrigin?: string,
): WebBrowserMode => {
	const local = isLocalServerUrl(rawUrl, appOrigin);
	if (requested === "tab" || requested === "window") return requested;
	return local ? "iframe" : "window";
};
