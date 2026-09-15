// Lazy transformers.js import for the media engine.
//
// Runs in a module Worker, where `chrome.runtime.getURL` does not exist: the
// ONNX Runtime WASM directory is resolved relative to this file instead, which
// works for both the extension (`chrome-extension://<id>/runner/...`) and the
// web build.

let transformersPromise = null;

export function mediaWasmPaths(baseUrl = import.meta.url) {
	return new URL("../../../vendors/transformers/", baseUrl).href;
}

export function ensureMediaTransformers() {
	if (!transformersPromise) {
		transformersPromise = (async () => {
			const transformers = await import("../../libs/transformers.js");
			if (!transformers?.pipeline) {
				throw new Error("Failed to load @huggingface/transformers");
			}
			const { env } = transformers;
			if (env) {
				env.useBrowserCache = true;
				env.allowLocalModels = false;
				const wasm = env.backends?.onnx?.wasm;
				if (wasm) {
					wasm.wasmPaths = mediaWasmPaths();
					wasm.proxy = false;
				}
			}
			return transformers;
		})().catch((error) => {
			transformersPromise = null;
			throw error;
		});
	}
	return transformersPromise;
}
