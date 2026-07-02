import type { CSSProperties } from "react";

/**
 * Inline style that lets the browser skip rendering (layout, paint, hit-testing)
 * for a list row while it is scrolled off-screen, then render it lazily when it
 * approaches the viewport. `contain-intrinsic-size: auto <h>` provides a size
 * placeholder so scrollbars/scroll position stay stable, and the `auto` keyword
 * makes the browser remember each row's real measured size once it has rendered.
 *
 * Unlike `DeferredMount`, the DOM is kept mounted — this only defers rendering
 * work — which is ideal for cheap, numerous list rows (logs, activities, …).
 *
 * @param intrinsicHeightPx estimated row height used as the placeholder size.
 */
export const contentVisibilityAuto = (
	intrinsicHeightPx: number,
): CSSProperties => ({
	contentVisibility: "auto",
	containIntrinsicSize: `auto ${intrinsicHeightPx}px`,
});
