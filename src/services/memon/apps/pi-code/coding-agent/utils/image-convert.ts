/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../LICENSE).
 * Browser port: PNG conversion with createImageBitmap and OffscreenCanvas
 * instead of Photon. Only used for Kitty inline images, which xterm.js
 * does not show, so this normally never runs.
 */
import { base64ToBytes, bytesToBase64 } from "../../platform/bytes";

export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	) {
		return null;
	}
	try {
		const bitmap = await createImageBitmap(
			new Blob([base64ToBytes(base64Data) as BlobPart], { type: mimeType }),
		);
		try {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
			const blob = await canvas.convertToBlob({ type: "image/png" });
			return {
				data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
				mimeType: "image/png",
			};
		} finally {
			bitmap.close();
		}
	} catch {
		return null;
	}
}
