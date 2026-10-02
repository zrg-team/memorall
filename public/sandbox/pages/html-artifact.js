/**
 * Shows one HTML artifact, scripts included.
 *
 * An iframe on the extension page itself takes that page's policy, which
 * blocks every inline script and handler the artifact has. This page is a
 * manifest sandbox page instead. The chat sends the page and the bytes of the
 * Files it shows (already swapped for placeholder tokens); the URLs for them
 * are made here, so they belong to this page and load.
 */
(() => {
	let rendered = false;

	window.addEventListener("message", (event) => {
		const data = event.data;
		if (rendered || event.source !== window.parent) return;
		if (!data || data.type !== "memorall-html-artifact:render") return;
		rendered = true;

		let html = String(data.html ?? "");
		for (const asset of Array.isArray(data.assets) ? data.assets : []) {
			const url = URL.createObjectURL(
				new Blob([asset.bytes], { type: asset.mime || "application/octet-stream" }),
			);
			html = html.split(asset.token).join(url);
		}

		document.open();
		document.write(html);
		document.close();
	});

	window.parent.postMessage({ type: "memorall-html-artifact:ready" }, "*");
})();
