const DEFAULT_TIMEOUT_MS = 15_000;

const MIME_TO_EXT: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"image/bmp": ".bmp",
	"image/tiff": ".tiff",
};

export interface DownloadResourceBytesArgs {
	url: string;
	timeoutMs?: number;
	maxBytes?: number;
	allowedMimeTypes?: string[];
}

export interface DownloadedResourceBytes {
	url: string;
	finalUrl: string;
	mimeType: string;
	bytes: Uint8Array;
	size: number;
}

export const extFromMime = (mimeType: string): string =>
	MIME_TO_EXT[mimeType.toLowerCase()] ?? ".png";

export const filenameFromUrl = (url: string, mimeType: string): string => {
	try {
		const { pathname } = new URL(url);
		const base = pathname.split("/").filter(Boolean).pop() ?? "";
		if (base && /\.\w{2,5}$/.test(base)) return base;
	} catch {
		// Fall through to generated filename.
	}
	return `asset-${crypto.randomUUID()}${extFromMime(mimeType)}`;
};

export const decodeBase64Bytes = (base64: string): Uint8Array => {
	const binaryStr = atob(base64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		bytes[i] = binaryStr.charCodeAt(i);
	}
	return bytes;
};

const normalizeMimeType = (contentType: string | null): string =>
	(contentType ?? "application/octet-stream").split(";", 1)[0].trim();

const assertAllowedMimeType = (
	mimeType: string,
	allowedMimeTypes?: string[],
): void => {
	if (!allowedMimeTypes?.length) return;
	const normalized = mimeType.toLowerCase();
	const allowed = allowedMimeTypes.some((allowedType) => {
		const candidate = allowedType.toLowerCase();
		return candidate.endsWith("/*")
			? normalized.startsWith(candidate.slice(0, -1))
			: normalized === candidate;
	});
	if (!allowed) {
		throw new Error(`Unsupported resource MIME type: ${mimeType}`);
	}
};

export const downloadResourceBytes = async ({
	url,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	maxBytes,
	allowedMimeTypes,
}: DownloadResourceBytesArgs): Promise<DownloadedResourceBytes> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(
				`Failed to download resource (status=${response.status})`,
			);
		}

		const mimeType = normalizeMimeType(response.headers.get("content-type"));
		assertAllowedMimeType(mimeType, allowedMimeTypes);

		const contentLength = Number(response.headers.get("content-length") ?? 0);
		if (maxBytes && contentLength > maxBytes) {
			throw new Error(`Resource is larger than ${maxBytes} bytes.`);
		}

		const bytes = new Uint8Array(await response.arrayBuffer());
		if (maxBytes && bytes.length > maxBytes) {
			throw new Error(`Resource is larger than ${maxBytes} bytes.`);
		}

		return {
			url,
			finalUrl: response.url || url,
			mimeType,
			bytes,
			size: bytes.length,
		};
	} finally {
		clearTimeout(timeout);
	}
};
