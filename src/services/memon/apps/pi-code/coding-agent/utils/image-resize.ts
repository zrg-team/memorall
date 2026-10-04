/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../LICENSE).
 * Browser port: same options, result and sizing strategy, but decoding and
 * encoding use createImageBitmap (which applies EXIF orientation) and
 * OffscreenCanvas instead of Photon (Rust/WASM).
 */
import type { ImageContent } from "@/services/memon/apps/pi-code/ai";
import {
	base64ToBytes,
	bytesToBase64,
	utf8ByteLength,
} from "../../platform/bytes";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB of base64 payload (below Anthropic's 5MB limit)
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	data: string; // base64
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

// 4.5MB of base64 payload. Provides headroom below Anthropic's 5MB limit.
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

interface EncodedCandidate {
	data: string;
	encodedSize: number;
	mimeType: string;
}

async function encodeCandidate(
	canvas: OffscreenCanvas,
	mimeType: string,
	quality?: number,
): Promise<EncodedCandidate> {
	const blob = await canvas.convertToBlob({ type: mimeType, quality });
	const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
	return {
		data,
		encodedSize: utf8ByteLength(data),
		mimeType: blob.type || mimeType,
	};
}

/**
 * Resize an image to fit within the specified max dimensions and encoded file size.
 * Returns null if the image cannot be resized below maxBytes.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions until 1x1
 */
export async function resizeImage(
	img: ImageContent,
	options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	if (
		typeof createImageBitmap !== "function" ||
		typeof OffscreenCanvas !== "function"
	) {
		return null;
	}

	let image: ImageBitmap | undefined;
	try {
		const inputBytes = base64ToBytes(img.data);
		const inputBase64Size = utf8ByteLength(img.data);
		image = await createImageBitmap(
			new Blob([inputBytes as BlobPart], { type: img.mimeType }),
		);

		const originalWidth = image.width;
		const originalHeight = image.height;
		const format = img.mimeType?.split("/")[1] ?? "png";

		if (
			originalWidth <= opts.maxWidth &&
			originalHeight <= opts.maxHeight &&
			inputBase64Size < opts.maxBytes
		) {
			return {
				data: img.data,
				mimeType: img.mimeType ?? `image/${format}`,
				originalWidth,
				originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
			};
		}

		let targetWidth = originalWidth;
		let targetHeight = originalHeight;

		if (targetWidth > opts.maxWidth) {
			targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
			targetWidth = opts.maxWidth;
		}
		if (targetHeight > opts.maxHeight) {
			targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
			targetHeight = opts.maxHeight;
		}

		const source = image;
		async function tryEncodings(
			width: number,
			height: number,
			jpegQualities: number[],
		): Promise<EncodedCandidate[]> {
			const canvas = new OffscreenCanvas(width, height);
			const context = canvas.getContext("2d");
			if (!context) return [];
			context.imageSmoothingQuality = "high";
			context.drawImage(source, 0, 0, width, height);
			const candidates: EncodedCandidate[] = [
				await encodeCandidate(canvas, "image/png"),
			];
			for (const quality of jpegQualities) {
				candidates.push(
					await encodeCandidate(canvas, "image/jpeg", quality / 100),
				);
			}
			return candidates;
		}

		const qualitySteps = Array.from(
			new Set([opts.jpegQuality, 85, 70, 55, 40]),
		);
		let currentWidth = targetWidth;
		let currentHeight = targetHeight;

		while (true) {
			const candidates = await tryEncodings(
				currentWidth,
				currentHeight,
				qualitySteps,
			);
			for (const candidate of candidates) {
				if (candidate.encodedSize < opts.maxBytes) {
					return {
						data: candidate.data,
						mimeType: candidate.mimeType,
						originalWidth,
						originalHeight,
						width: currentWidth,
						height: currentHeight,
						wasResized: true,
					};
				}
			}

			if (currentWidth === 1 && currentHeight === 1) {
				break;
			}

			const nextWidth =
				currentWidth === 1 ? 1 : Math.max(1, Math.floor(currentWidth * 0.75));
			const nextHeight =
				currentHeight === 1 ? 1 : Math.max(1, Math.floor(currentHeight * 0.75));
			if (nextWidth === currentWidth && nextHeight === currentHeight) {
				break;
			}

			currentWidth = nextWidth;
			currentHeight = nextHeight;
		}

		return null;
	} catch {
		return null;
	} finally {
		image?.close();
	}
}

/**
 * Format a dimension note for resized images.
 * This helps the model understand the coordinate mapping.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) {
		return undefined;
	}

	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
