import {
	actOnRef,
	buildPageOutline,
	elementOfRef,
} from "@/co-agent/dom/page-outline";
import {
	captureElement,
	captureViewport,
	pictureMaxSide,
} from "./page-capture";

// Runs inside an untrusted preview page. This bridge exposes only that page's
// DOM; it has no app APIs, filesystem access, credentials, or native invokes.
const cleanUrl = new URL(location.href);
cleanUrl.searchParams.delete("__memorall_preview");
cleanUrl.searchParams.delete("__memorall_guest_port");
history.replaceState(
	history.state,
	"",
	cleanUrl.pathname + cleanUrl.search + cleanUrl.hash,
);
const notify = () =>
	parent.postMessage(
		{
			type: "memorall-preview-ready",
			path: location.pathname + location.search,
		},
		"*",
	);
window.addEventListener("message", (event) => {
	if (
		event.source !== parent ||
		event.data?.type !== "memorall-preview-request" ||
		typeof event.data.id !== "string"
	)
		return;
	const { id, operation, payload } = event.data;
	void (async () => {
		if (operation === "outline")
			return buildPageOutline(document, { maxChars: payload?.maxChars });
		if (operation === "act") {
			const result = actOnRef(document, payload.request);
			await new Promise((resolve) => setTimeout(resolve, 120));
			return {
				result,
				outline: buildPageOutline(document, { maxChars: payload.maxChars }),
			};
		}
		if (operation === "capture") {
			const request = payload ?? {};
			if (!request.ref)
				return captureViewport(document, pictureMaxSide(request), request);
			const described = actOnRef(document, { ...request, action: "describe" });
			return captureElement(
				elementOfRef(document, request.ref, request.docToken),
				described.ok ? described.detail : undefined,
				pictureMaxSide(request),
			);
		}
		if (operation === "history") {
			payload === "back" ? history.back() : history.forward();
			return null;
		}
		throw new Error("Unsupported preview operation");
	})().then(
		(result) =>
			parent.postMessage(
				{ type: "memorall-preview-response", id, result },
				event.origin,
			),
		(error) =>
			parent.postMessage(
				{ type: "memorall-preview-response", id, error: String(error) },
				event.origin,
			),
	);
});
window.addEventListener("load", notify);
window.addEventListener("popstate", notify);
for (const key of ["pushState", "replaceState"] as const) {
	const original = history[key].bind(history);
	history[key] = (data: unknown, unused: string, url?: string | URL | null) => {
		original(data, unused, url);
		notify();
	};
}
if (document.readyState === "complete") notify();
