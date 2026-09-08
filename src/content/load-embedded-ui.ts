/**
 * Loads the content script's on-demand bundles.
 *
 * A content script runs in an isolated world, but the bundler's chunk loader
 * fetches a chunk by appending a `<script>` tag to the document — which the
 * browser executes in the *page's* world. The chunk then registers itself on the
 * page's `rspackChunkmemorall` and this world waits for a registration that
 * never arrives, so every bundler-managed dynamic import here failed with
 * `ChunkLoadError: Loading chunk N failed (missing: …)`.
 *
 * A native `import()` evaluates in the calling world, so the bundles are built
 * as separate ES module entries (see `extension.config.cjs`) and pulled in by
 * URL. Keeping that behind this module means `src/content.ts` holds no
 * runtime reference to the UI graph, and tests have one seam to replace.
 */

import type * as CoAgentModule from "@/embedded/pages/CoAgent";
import type * as MemoryHandlersModule from "./modules/memory-handlers";
import type * as UiHandlersModule from "./modules/ui-handlers";

export interface EmbeddedUiBundle {
	readonly coAgent: typeof CoAgentModule;
	readonly memoryHandlers: typeof MemoryHandlersModule;
	readonly uiHandlers: typeof UiHandlersModule;
}

/**
 * Resolves a packaged asset path to a URL. The host supplies it — the extension
 * passes its runtime `getURL` — so this module stays free of platform APIs, as
 * everything under src/content/ must be.
 */
export type ResolveAssetUrl = (path: string) => string;

let embeddedUiBundle: Promise<EmbeddedUiBundle> | null = null;

export const loadEmbeddedUi = (
	resolveAssetUrl: ResolveAssetUrl,
): Promise<EmbeddedUiBundle> => {
	if (!embeddedUiBundle) {
		embeddedUiBundle = import(
			/* webpackIgnore: true */ resolveAssetUrl("embedded/embedded-ui.js")
		) as Promise<EmbeddedUiBundle>;
		// A failed load must not poison every later message.
		embeddedUiBundle.catch(() => {
			embeddedUiBundle = null;
		});
	}
	return embeddedUiBundle;
};

/** Side-effect only: registers the activity-tracking listeners. */
export const loadActivityTracker = (
	resolveAssetUrl: ResolveAssetUrl,
): Promise<unknown> =>
	import(
		/* webpackIgnore: true */ resolveAssetUrl("embedded/activity-tracker.js")
	);
