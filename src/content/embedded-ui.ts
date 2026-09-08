/**
 * On-demand bundle for the content script's user interface.
 *
 * This is a separate build entry rather than a dynamic import inside
 * `src/content.ts` on purpose. A content script runs in an isolated world, but
 * the bundler's default chunk loader fetches a chunk by appending a `<script>`
 * tag to the document — which executes in the *page's* world. The chunk then
 * registers itself on the page's `rspackChunkmemorall` and the isolated world
 * waits for a registration that never arrives, so every deferred import failed
 * with `ChunkLoadError: Loading chunk N failed (missing: …)` and the embedded
 * chat, co-agent, topic selector and image selector reported themselves as
 * "unavailable on this page" everywhere.
 *
 * Emitted as an ES module (see `extension.config.cjs`) so the content script can
 * pull it in with a native `import()`, which evaluates in the calling world.
 */

export * as coAgent from "@/embedded/pages/CoAgent";
export * as memoryHandlers from "./modules/memory-handlers";
export * as uiHandlers from "./modules/ui-handlers";
