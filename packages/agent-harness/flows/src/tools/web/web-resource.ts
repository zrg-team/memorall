import type { AllServices } from "../../interfaces/services/services.js";
import type {
	WebDownloadedResource,
	WebSession,
} from "../../interfaces/services/web-browser.js";
import {
	downloadResourceBytes,
	refineMimeType,
	resourceFileName,
} from "../../utils/download-resource.js";
import { normalizeFsPath, writeFileBytes } from "../fs/util.js";
import { isPageContentType } from "./file-content-type.js";
import { truncateContent } from "./web-tool-utils.js";

export { isPageContentType, looksLikeFileUrl } from "./file-content-type.js";

/**
 * Files at a web address: a PDF, an image, a video, an archive.
 *
 * A browser shows such an address in its own viewer (or just downloads it),
 * so the page a web tool reads there is an empty shell: a PDF tab's DOM is a
 * single `<embed>`. The tools fetch the file itself instead, save it to the
 * filesystem, and give back its readable text when the backend can extract it.
 */
export type WebResourceServices = Pick<AllServices, "webBrowser" | "fs">;

/**
 * Where a web tool saves a file, unless told otherwise: scratch space, kept
 * out of the file index. A file worth keeping is moved or saved elsewhere.
 */
export const WEB_DOWNLOADS_DIR = "/tmp/downloads";

/** Largest file a web tool saves. */
export const WEB_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

/** A file can be far larger than a page: give its download longer. */
export const WEB_DOWNLOAD_TIMEOUT_MS = 60_000;

/** The session's page is a file in the browser's viewer, not a web page. */
export const isFileSession = (session: Pick<WebSession, "contentType">) =>
	!isPageContentType(session.contentType);

/**
 * A file's bytes, through the backend when it can fetch (from inside the
 * session's page, with the site's cookies), else with a plain download.
 */
export const downloadWebResource = async (
	services: WebResourceServices,
	{
		url,
		sessionId,
		timeoutMs = WEB_DOWNLOAD_TIMEOUT_MS,
		maxBytes = WEB_DOWNLOAD_MAX_BYTES,
	}: {
		url: string;
		sessionId?: string;
		timeoutMs?: number;
		maxBytes?: number;
	},
): Promise<WebDownloadedResource> => {
	const downloaded = services.webBrowser?.downloadResource
		? await services.webBrowser.downloadResource({
				url,
				sessionId,
				timeoutMs,
				maxBytes,
			})
		: await downloadResourceBytes({ url, timeoutMs, maxBytes }).then(
				(resource) => ({
					url: resource.finalUrl,
					mimeType: resource.mimeType,
					bytes: resource.bytes,
					filename: resource.filename,
				}),
			);
	return {
		...downloaded,
		mimeType: refineMimeType(downloaded.mimeType, downloaded.bytes),
	};
};

/**
 * The file's readable text: text formats decoded here, anything else (a PDF)
 * by the backend. Null when there is none to give, never an error: a file
 * that cannot be read is still saved.
 */
export const readWebResourceText = async (
	services: WebResourceServices,
	resource: WebDownloadedResource,
): Promise<string | null> => {
	if (isPageContentType(resource.mimeType)) {
		return new TextDecoder().decode(resource.bytes);
	}
	const readResourceText = services.webBrowser?.readResourceText;
	if (!readResourceText) return null;
	try {
		const text = await readResourceText({
			url: resource.url,
			mimeType: resource.mimeType,
			bytes: resource.bytes,
		});
		return text?.trim() ? text : null;
	} catch {
		return null;
	}
};

/**
 * Where to save a file: the given path, a folder given with a trailing slash,
 * or the downloads folder.
 */
const savePathFor = (
	resource: WebDownloadedResource,
	filePath?: string,
): string => {
	const name = resourceFileName(
		resource.url,
		resource.mimeType,
		resource.filename,
	);
	const target = filePath?.trim();
	if (!target) return normalizeFsPath(`${WEB_DOWNLOADS_DIR}/${name}`);
	return normalizeFsPath(/[\\/]$/.test(target) ? `${target}${name}` : target);
};

export interface WebSavedFile {
	/** Where the bytes came from, after redirects. */
	url: string;
	mimeType: string;
	size: number;
	/** Where it was saved. Absent when there is no filesystem to save to. */
	path?: string;
	/** Readable text, when asked for and the format has any. */
	text?: string | null;
}

/** Save a downloaded file and, when asked, read its text. */
export const saveWebResource = async (
	services: WebResourceServices,
	resource: WebDownloadedResource,
	{ filePath, readText = false }: { filePath?: string; readText?: boolean },
): Promise<WebSavedFile> => {
	let path: string | undefined;
	if (services.fs) {
		path = savePathFor(resource, filePath);
		await writeFileBytes(services.fs, path, resource.bytes);
	}
	return {
		url: resource.url,
		mimeType: resource.mimeType,
		size: resource.bytes.length,
		...(path ? { path } : {}),
		...(readText
			? { text: await readWebResourceText(services, resource) }
			: {}),
	};
};

/**
 * Download the address and save it, when it is a file. Null when it turns out
 * to be a page (a login page served in a PDF's place) or cannot be fetched at
 * all: the caller opens it as a page instead.
 */
export const saveFileAt = async (
	services: WebResourceServices,
	url: string,
): Promise<WebSavedFile | null> => {
	try {
		const resource = await downloadWebResource(services, { url });
		if (isPageContentType(resource.mimeType)) return null;
		return await saveWebResource(services, resource, { readText: true });
	} catch {
		return null;
	}
};

/** Save the file a session's tab is showing, fetched from inside that tab. */
export const saveSessionFile = async (
	services: WebResourceServices,
	session: Pick<WebSession, "id" | "currentUrl" | "requestedUrl">,
): Promise<WebSavedFile> => {
	const resource = await downloadWebResource(services, {
		url: session.currentUrl || session.requestedUrl,
		sessionId: session.id,
	});
	return saveWebResource(services, resource, { readText: true });
};

export interface WebTextMatch {
	index: number;
	/** The line the match is on. */
	text: string;
	snippet: string;
}

/** Find a pattern in a file's text, the way find-in-page does in a page. */
export const findInText = (
	text: string,
	{
		pattern,
		isRegex,
		caseSensitive,
		maxMatches,
		maxSnippetChars,
	}: {
		pattern: string;
		isRegex: boolean;
		caseSensitive: boolean;
		maxMatches: number;
		maxSnippetChars: number;
	},
): WebTextMatch[] => {
	const source = isRegex
		? pattern
		: pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
	const matcher = new RegExp(source, caseSensitive ? "g" : "gi");
	const matches: WebTextMatch[] = [];
	for (const match of text.matchAll(matcher)) {
		if (matches.length >= maxMatches) break;
		if (!match[0]) continue;
		const at = match.index ?? 0;
		const lineStart = text.lastIndexOf("\n", at) + 1;
		const lineEnd = text.indexOf("\n", at);
		const start = Math.max(0, at - 80);
		matches.push({
			index: matches.length,
			text: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim(),
			snippet: text
				.slice(start, start + maxSnippetChars)
				.replace(/\s+/g, " ")
				.trim(),
		});
	}
	return matches;
};

/**
 * Result fields describing a file a page tool met instead of a page, spread
 * into its payload. `text` is the file's readable text, cut to `maxChars`.
 */
export const webFileFields = (
	file: WebSavedFile,
	maxChars: number,
): Record<string, unknown> => {
	const text = file.text ? truncateContent(file.text, maxChars) : null;
	const where = file.path
		? `It was saved to ${file.path}`
		: "There is no filesystem to save it to";
	const reading = file.text
		? file.text.length > maxChars
			? "`text` holds the start of its readable text; read the rest from the saved file."
			: "`text` holds its readable text."
		: "It has no text this tool can read.";
	return {
		file: {
			url: file.url,
			mimeType: file.mimeType,
			size: file.size,
			...(file.path ? { path: file.path } : {}),
		},
		text,
		hint: `This address is a file (${file.mimeType}), not a web page. ${where}. ${reading}`,
	};
};
