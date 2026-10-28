/**
 * Telling a page from a file, by its type or its address. No imports, so a
 * session layer can classify a snapshot without loading the web tools.
 */

/**
 * Extensions whose address is a file rather than a page. Text formats a tab
 * renders readably (.txt, .json, .xml, .md) are left out: they read fine as
 * pages. CSV is in, because browsers download it instead of showing it.
 */
const FILE_URL_EXTENSIONS = new Set([
	"pdf",
	"epub",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"odt",
	"ods",
	"odp",
	"rtf",
	"csv",
	"tsv",
	"zip",
	"gz",
	"tgz",
	"tar",
	"7z",
	"rar",
	"bz2",
	"xz",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"bmp",
	"tif",
	"tiff",
	"ico",
	"heic",
	"svg",
	"mp3",
	"wav",
	"ogg",
	"oga",
	"m4a",
	"flac",
	"aac",
	"mp4",
	"m4v",
	"webm",
	"mov",
	"mkv",
	"avi",
	"woff",
	"woff2",
	"ttf",
	"otf",
	"wasm",
	"bin",
	"dmg",
	"exe",
	"msi",
	"apk",
	"deb",
	"rpm",
	"iso",
	"parquet",
	"sqlite",
	"db",
]);

const normalizeMimeType = (value?: string | null): string =>
	(value ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";

/**
 * Whether a document type is a page to read rather than a file to save.
 *
 * HTML, XML, JSON and plain text render as text the DOM gives back. A PDF,
 * an image, audio or video loads in the browser's viewer with nothing to read.
 * No type at all reads as a page: that is every backend that does not report
 * one.
 */
export const isPageContentType = (contentType?: string | null): boolean => {
	const type = normalizeMimeType(contentType);
	if (!type) return true;
	if (/^(image|audio|video|font)\//.test(type)) return false;
	return (
		type.startsWith("text/") ||
		type === "application/json" ||
		type === "application/xml" ||
		type === "application/javascript" ||
		type.endsWith("+xml") ||
		type.endsWith("+json")
	);
};

/** The address names a file by its extension (`/paper.pdf`, `/a.zip`). */
export const looksLikeFileUrl = (url: string): boolean => {
	try {
		const { pathname, protocol } = new URL(url);
		if (protocol !== "http:" && protocol !== "https:") return false;
		const name = pathname.split("/").pop() ?? "";
		const dot = name.lastIndexOf(".");
		return (
			dot > 0 && FILE_URL_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
		);
	} catch {
		return false;
	}
};
