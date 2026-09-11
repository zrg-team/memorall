import { useEffect, useRef } from "react";

/**
 * Re-read the open conversation when the user comes back to this page.
 *
 * The co-agent writes its turns from a content script, straight into the same
 * conversation this page is showing. Nothing tells this page about it, so
 * messages written while the user was on the web page were simply missing when
 * they switched back, and stayed missing until the conversation was reopened —
 * which reads as lost work.
 *
 * Both events are needed: `visibilitychange` covers switching tabs and
 * minimising, `focus` covers moving between windows without the tab ever being
 * hidden, which is the common case for the side panel and a page side by side.
 */
export const useRefreshOnFocus = (
	refresh: (() => void | Promise<void>) | undefined,
	options: { enabled?: boolean } = {},
): void => {
	const { enabled = true } = options;
	// Held in a ref so a caller passing an inline function does not re-subscribe
	// on every render.
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;

	useEffect(() => {
		if (!enabled) return;

		let running = false;
		const run = () => {
			if (running || document.visibilityState === "hidden") return;
			const next = refreshRef.current;
			if (!next) return;
			running = true;
			void Promise.resolve(next()).finally(() => {
				running = false;
			});
		};

		const onVisibility = () => {
			if (document.visibilityState === "visible") run();
		};

		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", run);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", run);
		};
	}, [enabled]);
};
