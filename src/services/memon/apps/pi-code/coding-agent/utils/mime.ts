/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../LICENSE).
 * Browser port: the four image types pi sends inline are recognised from
 * their magic bytes instead of with the file-type package and a file handle.
 */

const IMAGE_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);

/** Bytes needed to recognise every type below. */
export const IMAGE_SNIFF_BYTES = 12;

const startsWith = (
	bytes: Uint8Array,
	signature: number[],
	offset = 0,
): boolean => signature.every((byte, index) => bytes[offset + index] === byte);

export function detectSupportedImageMimeType(bytes: Uint8Array): string | null {
	let mime: string | null = null;
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) mime = "image/jpeg";
	else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		mime = "image/png";
	else if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) mime = "image/gif";
	else if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		mime = "image/webp";
	}
	return mime && IMAGE_MIME_TYPES.has(mime) ? mime : null;
}
