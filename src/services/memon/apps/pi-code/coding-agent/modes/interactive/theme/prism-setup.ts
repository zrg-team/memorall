/**
 * Prism reads these flags from a global `Prism` when its core loads. Without
 * them it would re-highlight the host page's code blocks on DOMContentLoaded
 * and listen for worker messages. Import this module before "prismjs".
 */
const scope = globalThis as { Prism?: Record<string, unknown> };
scope.Prism = {
	...scope.Prism,
	manual: true,
	disableWorkerMessageHandler: true,
};

export {};
