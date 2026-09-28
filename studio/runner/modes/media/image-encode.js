// RawImage <-> bytes conversions. `RawImage.fromBlob`/`toBlob` use
// createImageBitmap and OffscreenCanvas, both available in module workers.

/**
 * @param {any} RawImage transformers.js `RawImage` class
 * @param {ArrayBuffer | Uint8Array} bytes Encoded image file
 * @param {string} [mimeType]
 */
export async function decodeImage(RawImage, bytes, mimeType) {
	if (!bytes || bytes.byteLength === 0) {
		throw new Error("Image payload is empty");
	}
	const blob = new Blob([bytes], { type: mimeType || "image/png" });
	return RawImage.fromBlob(blob);
}

/**
 * @param {any} image RawImage
 * @param {"mask" | "cutout" | "depth"} [role]
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string, role?: string, width: number, height: number }>}
 */
export async function encodePng(image, role) {
	const blob = await image.toBlob("image/png");
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const output = {
		bytes,
		mimeType: "image/png",
		width: image.width,
		height: image.height,
	};
	if (role) output.role = role;
	return output;
}
