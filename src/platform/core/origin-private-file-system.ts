/**
 * Whether this browser exposes the origin private file system.
 *
 * On-device GGUF models (Wllama) are stored there, so without it that provider
 * cannot hold a model at all — it fails at the point of download with an opaque
 * "No supported storage backend found". Every capability registry reports this
 * so the UI can say so up front instead.
 */
export function hasOriginPrivateFileSystem(): boolean {
	return (
		typeof navigator !== "undefined" &&
		typeof navigator.storage?.getDirectory === "function"
	);
}
