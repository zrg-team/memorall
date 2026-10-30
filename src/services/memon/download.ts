import { resourceFileName } from "@memorall/agent-harness-flows/utils/download-resource";

/** Where downloads go when no folder is given, under the agent's home. */
export const MEMON_DOWNLOADS_DIR = "~/Downloads";

/** Where pictures of pages go when the chat's model cannot look at them. */
export const MEMON_PICTURES_DIR = "~/Pictures";

/** Largest file a download saves. */
export const MEMON_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

/**
 * A downloaded file's name: the server's, else the last part of its address,
 * with its type's extension added when the name does not carry it. The web
 * tools name files the same way.
 *
 * Any dot used to count as an extension, so an arXiv PDF at /pdf/2610.32253
 * was saved as "2610.32253" and later opened as text.
 */
export const downloadFileName = (
	url: string,
	contentType: string,
	suggestedName?: string,
): string => resourceFileName(url, contentType, suggestedName);

/** A byte count as a person reads it. */
export const formatDownloadSize = (bytes: number): string =>
	bytes < 1024
		? `${bytes} B`
		: bytes < 1024 * 1024
			? `${Math.round(bytes / 1024)} KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
