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

/**
 * Extensions a downloaded file of each type may carry, the usual one first.
 * Wider than MIME_TO_EXT, which only ever names images.
 */
const RESOURCE_EXTENSIONS: Record<string, string[]> = {
	"application/pdf": [".pdf"],
	"application/zip": [".zip"],
	"application/x-zip-compressed": [".zip"],
	"application/gzip": [".gz", ".tgz"],
	"application/x-gzip": [".gz", ".tgz"],
	"application/x-tar": [".tar"],
	"application/x-7z-compressed": [".7z"],
	"application/vnd.rar": [".rar"],
	"application/x-rar-compressed": [".rar"],
	"application/epub+zip": [".epub"],
	"application/msword": [".doc"],
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
		".docx",
	],
	"application/vnd.ms-excel": [".xls"],
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
		".xlsx",
	],
	"application/vnd.ms-powerpoint": [".ppt"],
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": [
		".pptx",
	],
	"application/vnd.oasis.opendocument.text": [".odt"],
	"application/vnd.oasis.opendocument.spreadsheet": [".ods"],
	"application/vnd.oasis.opendocument.presentation": [".odp"],
	"application/rtf": [".rtf"],
	"application/json": [".json"],
	"application/xml": [".xml"],
	"application/wasm": [".wasm"],
	"text/csv": [".csv"],
	"text/tab-separated-values": [".tsv"],
	"text/markdown": [".md", ".markdown"],
	"text/html": [".html", ".htm"],
	"text/plain": [".txt"],
	"image/png": [".png"],
	"image/jpeg": [".jpg", ".jpeg"],
	"image/gif": [".gif"],
	"image/webp": [".webp"],
	"image/avif": [".avif"],
	"image/svg+xml": [".svg"],
	"image/bmp": [".bmp"],
	"image/tiff": [".tiff", ".tif"],
	"image/x-icon": [".ico"],
	"image/vnd.microsoft.icon": [".ico"],
	"audio/mpeg": [".mp3"],
	"audio/wav": [".wav"],
	"audio/x-wav": [".wav"],
	"audio/ogg": [".ogg", ".oga"],
	"audio/mp4": [".m4a"],
	"audio/flac": [".flac"],
	"audio/aac": [".aac"],
	"video/mp4": [".mp4", ".m4v"],
	"video/webm": [".webm"],
	"video/quicktime": [".mov"],
	"video/x-matroska": [".mkv"],
	"font/woff2": [".woff2"],
	"font/woff": [".woff"],
	"font/ttf": [".ttf"],
	"font/otf": [".otf"],
};

/** Types that say nothing about what the bytes are. */
const GENERIC_MIME_TYPES = new Set([
	"",
	"application/octet-stream",
	"binary/octet-stream",
	"application/binary",
	"application/unknown",
	"application/force-download",
	"application/x-download",
]);

/** File signatures, for a server that labels everything octet-stream. */
const SIGNATURES: Array<{
	mimeType: string;
	bytes: number[];
	offset?: number;
}> = [
	{ mimeType: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
	{ mimeType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
	{ mimeType: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
	{ mimeType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
	{ mimeType: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
	{ mimeType: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
	{ mimeType: "application/gzip", bytes: [0x1f, 0x8b] },
];

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
	/** The name the server gave the file (Content-Disposition), when any. */
	filename?: string;
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
	(contentType ?? "application/octet-stream").split(";", 1)[0]?.trim() ??
	"application/octet-stream";

/**
 * The type the bytes actually are, when the declared one says nothing.
 *
 * Only a generic declaration is second-guessed: a server that names a type is
 * taken at its word.
 */
export const refineMimeType = (mimeType: string, bytes: Uint8Array): string => {
	const declared = normalizeMimeType(mimeType).toLowerCase();
	if (!GENERIC_MIME_TYPES.has(declared)) return declared;
	const match = SIGNATURES.find(({ bytes: signature, offset = 0 }) =>
		signature.every((value, index) => bytes[offset + index] === value),
	);
	return match?.mimeType ?? (declared || "application/octet-stream");
};

/** The file name in a Content-Disposition header, if it gives one. */
export const filenameFromContentDisposition = (
	header: string | null | undefined,
): string | undefined => {
	if (!header) return undefined;
	const extended = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(header);
	if (extended?.[1]) {
		try {
			return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
		} catch {
			// Fall through to the plain parameter.
		}
	}
	const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
	const name = (plain?.[2] ?? plain?.[1])?.trim();
	return name || undefined;
};

/**
 * A downloaded file's name: the server's, else the last part of its address,
 * with its type's extension added when the name does not already carry it.
 *
 * Readers pick a format by extension, and an address's last part is often not
 * a file name at all: an arXiv paper lives at `/pdf/2610.32253`, whose
 * ".32253" would make the saved PDF unreadable as one.
 */
export const resourceFileName = (
	url: string,
	mimeType: string,
	suggestedName?: string,
): string => {
	let name = suggestedName?.trim() ?? "";
	if (!name) {
		try {
			name = decodeURIComponent(
				new URL(url).pathname.split("/").filter(Boolean).pop() ?? "",
			);
		} catch {
			name = "";
		}
	}
	name =
		name
			.replace(/[\\/:*?"<>|]+/g, "-")
			.replace(/^\.+/, "")
			.trim() || "download";

	const type = normalizeMimeType(mimeType).toLowerCase();
	const extensions = RESOURCE_EXTENSIONS[type];
	const lower = name.toLowerCase();
	const hasOwnExtension = extensions?.some((extension) =>
		lower.endsWith(extension),
	);
	// A generic or textual type fits whatever extension the name already has.
	const keepsAnyExtension =
		!extensions || type.startsWith("text/") || GENERIC_MIME_TYPES.has(type);
	if (
		extensions &&
		!hasOwnExtension &&
		!(keepsAnyExtension && /\.[a-z0-9]{1,8}$/i.test(name))
	) {
		name += extensions[0] ?? "";
	}
	return name.length > 120 ? name.slice(-120) : name;
};

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

		const filename = filenameFromContentDisposition(
			response.headers.get("content-disposition"),
		);
		return {
			url,
			finalUrl: response.url || url,
			mimeType,
			bytes,
			size: bytes.length,
			...(filename ? { filename } : {}),
		};
	} finally {
		clearTimeout(timeout);
	}
};
