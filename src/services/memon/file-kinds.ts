import type { DocumentType } from "@/types/document-library";

/**
 * How the computer opens a file. Text opens in the Editor; the rest opens in
 * the Viewer, matching what the Files page can preview.
 */
export type MemonViewerKind =
	| "pdf"
	| "image"
	| "audio"
	| "video"
	| "excel"
	| "document"
	| "binary";
export type MemonFileKind = "text" | MemonViewerKind;

const EXTENSION_KIND: Record<string, MemonViewerKind> = {
	pdf: "pdf",
	jpg: "image",
	jpeg: "image",
	png: "image",
	gif: "image",
	webp: "image",
	wav: "audio",
	mp3: "audio",
	ogg: "audio",
	oga: "audio",
	m4a: "audio",
	flac: "audio",
	mp4: "video",
	m4v: "video",
	mov: "video",
	webm: "video",
	ogv: "video",
	mkv: "video",
	xls: "excel",
	xlsx: "excel",
	xlsm: "excel",
	docx: "document",
	// Opened as bytes: decoding them as text would only show noise.
	doc: "binary",
	ppt: "binary",
	pptx: "binary",
	odt: "binary",
	zip: "binary",
	gz: "binary",
	tar: "binary",
	"7z": "binary",
	rar: "binary",
	exe: "binary",
	wasm: "binary",
	woff: "binary",
	woff2: "binary",
	ttf: "binary",
	otf: "binary",
	ico: "binary",
	bmp: "binary",
	tif: "binary",
	tiff: "binary",
};

const MIME_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	wav: "audio/wav",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	m4a: "audio/mp4",
	flac: "audio/flac",
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	ogv: "video/ogg",
	mkv: "video/x-matroska",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	md: "text/markdown",
	markdown: "text/markdown",
	html: "text/html",
	htm: "text/html",
	txt: "text/plain",
};

const extensionOf = (path: string): string =>
	/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? "";

export const memonFileKind = (path: string): MemonFileKind =>
	EXTENSION_KIND[extensionOf(path)] ?? "text";

export const memonMimeType = (path: string): string =>
	MIME_TYPES[extensionOf(path)] ?? "application/octet-stream";

/**
 * The document type a chat attachment of this file is sent as, or null when
 * chat cannot send it (audio, video and other binaries have no text to add).
 */
export const memonAttachmentType = (path: string): DocumentType | null => {
	const kind = memonFileKind(path);
	if (kind === "pdf" || kind === "image" || kind === "excel") return kind;
	if (kind !== "text") return null;
	const extension = extensionOf(path);
	if (extension === "md" || extension === "markdown") return "markdown";
	return extension === "txt" ? "text" : "other";
};
