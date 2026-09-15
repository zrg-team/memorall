// Buffers worth moving (not copying) across postMessage: PCM frames, decoded
// audio and encoded images. Each buffer is listed once; listing a buffer twice
// makes postMessage throw.

const isArrayBuffer = (value) =>
	Object.prototype.toString.call(value) === "[object ArrayBuffer]";

function ownsWholeBuffer(view) {
	return (
		ArrayBuffer.isView(view) &&
		isArrayBuffer(view.buffer) &&
		view.byteOffset === 0 &&
		view.byteLength === view.buffer.byteLength
	);
}

/** A typed array that owns its whole buffer, copying only when it does not. */
export function detachableCopy(view) {
	return ownsWholeBuffer(view) ? view : view.slice();
}

/**
 * @param {any} payload
 * @returns {ArrayBuffer[]}
 */
export function collectTransferables(payload) {
	const buffers = new Set();
	const add = (value) => {
		if (isArrayBuffer(value)) {
			buffers.add(value);
		} else if (ownsWholeBuffer(value)) {
			buffers.add(value.buffer);
		}
	};
	if (!payload || typeof payload !== "object") return [];
	add(payload.pcm);
	add(payload.audio);
	add(payload.image);
	if (Array.isArray(payload.images)) {
		for (const image of payload.images) add(image?.bytes);
	}
	return [...buffers];
}
