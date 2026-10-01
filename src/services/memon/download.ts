/** Where downloads go when no folder is given, under the agent's home. */
export const MEMON_DOWNLOADS_DIR = "~/Downloads";

/** Largest file a download saves. */
export const MEMON_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** The extension a Content-Type says a file has. */
const EXTENSIONS: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/avif": ".avif",
	"image/svg+xml": ".svg",
	"image/x-icon": ".ico",
	"image/vnd.microsoft.icon": ".ico",
	"font/woff2": ".woff2",
	"font/woff": ".woff",
	"font/ttf": ".ttf",
	"font/otf": ".otf",
	"application/pdf": ".pdf",
	"application/json": ".json",
	"application/zip": ".zip",
	"text/css": ".css",
	"text/javascript": ".js",
	"application/javascript": ".js",
	"text/html": ".html",
	"text/markdown": ".md",
	"text/csv": ".csv",
	"text/plain": ".txt",
	"audio/mpeg": ".mp3",
	"audio/wav": ".wav",
	"audio/ogg": ".ogg",
	"video/mp4": ".mp4",
	"video/webm": ".webm",
};

/**
 * A downloaded file's name: the last part of its address, with the
 * extension its type has when the address gives none.
 */
export const downloadFileName = (url: string, contentType: string): string => {
	let name = "";
	try {
		name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
	} catch {
		name = "";
	}
	name = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "download";
	const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	const extension = EXTENSIONS[type];
	if (extension && !/\.[a-z0-9]{1,8}$/i.test(name)) name += extension;
	return name.length > 120 ? name.slice(-120) : name;
};

/** A byte count as a person reads it. */
export const formatDownloadSize = (bytes: number): string =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${Math.round(bytes / 1024)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
