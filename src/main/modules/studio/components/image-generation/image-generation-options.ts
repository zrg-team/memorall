export type ImageQuality = "auto" | "low" | "medium" | "high";

export const IMAGE_QUALITIES: readonly ImageQuality[] = [
	"auto",
	"low",
	"medium",
	"high",
];

export const MAX_IMAGE_COUNT = 4;

export type ImageOrientation = "square" | "landscape" | "portrait" | "auto";

/** `"1024x1536"` -> `{ width: 1024, height: 1536 }`; `"auto"` and junk -> null. */
export function parseImageSize(size: string | undefined): {
	width: number;
	height: number;
} | null {
	const match = size?.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * CSS `aspect-ratio` for a requested size, so a placeholder tile takes the
 * shape of the image it is waiting for and the gallery does not jump when the
 * image lands. Unknown sizes ("auto") render square.
 */
export function aspectRatioOf(size: string | undefined): string {
	const parsed = parseImageSize(size);
	return parsed ? `${parsed.width} / ${parsed.height}` : "1 / 1";
}

export function orientationOf(size: string | undefined): ImageOrientation {
	const parsed = parseImageSize(size);
	if (!parsed) return "auto";
	if (parsed.width === parsed.height) return "square";
	return parsed.width > parsed.height ? "landscape" : "portrait";
}

/** `"1024x1024"` -> `"1024×1024"` for display. */
export const formatImageSize = (size: string) => size.replace(/x/i, "×");

/**
 * Sizes offered by the composer. `size` is a free parameter of the OpenAI
 * images API, so these are common shapes rather than a per-model list;
 * "auto" sends no size and lets the server decide. A server that rejects a
 * size reports it on the generation card.
 */
export const IMAGE_SIZES: readonly string[] = [
	"auto",
	"1024x1024",
	"1536x1024",
	"1024x1536",
	"512x512",
];

/** "auto" and blank mean "let the server pick", so nothing is sent. */
export const sizeParam = (size: string | undefined) =>
	size && size !== "auto" ? size : undefined;

export const clampImageCount = (value: unknown) => {
	const number =
		typeof value === "number" && Number.isFinite(value) ? value : 1;
	return Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.round(number)));
};

/** A seed in the 32-bit range every sampler accepts. */
export const randomSeed = (random: () => number = Math.random) =>
	Math.floor(random() * 2 ** 31);

const EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif": "gif",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/mpeg": "mp3",
	"audio/ogg": "ogg",
	"audio/webm": "webm",
	"audio/mp4": "m4a",
	"audio/flac": "flac",
	"text/plain": "txt",
	"text/markdown": "md",
};

/** A readable file name from the prompt or file a generation came from. */
export function downloadFileName(
	text: string,
	mimeType: string,
	suffix?: string,
	fallback = "image",
): string {
	const slug =
		text
			.toLowerCase()
			.normalize("NFKD")
			// Strip accents so Vietnamese prompts keep their letters in file names.
			.replace(/\p{M}/gu, "")
			.replace(/\.[a-z0-9]{2,4}$/i, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48)
			.replace(/-+$/g, "") || fallback;
	const extension = EXTENSIONS[mimeType] ?? mimeType.split("/")[1] ?? "png";
	return `${slug}${suffix ? `-${suffix}` : ""}.${extension}`;
}
