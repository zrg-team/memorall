export async function waitForDOMReady(): Promise<void> {
	return new Promise<void>((resolve) => {
		if (typeof document === "undefined") {
			// If document is not available at all, resolve immediately
			// This allows the class to work in non-DOM environments
			resolve();
			return;
		}

		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", () => resolve());
		} else {
			// DOM is already ready
			resolve();
		}
	});
}
