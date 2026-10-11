import type { DocumentType } from "@/types/document-library";

/**
 * The two places an index works with: the index store (`/home/indexes`, the
 * app's own files) and the library (the user's files, read only). Kept as
 * interfaces so indexers can be tested against memory.
 */

export interface IndexStoreEntry {
	name: string;
	kind: "file" | "folder";
}

export interface IndexStoreIO {
	/** The file's text, or null when it does not exist. */
	read(path: string): Promise<string | null>;
	/** Writes a file, making its folders. */
	write(path: string, text: string): Promise<void>;
	/** Removes a file or a folder with everything in it; absent is fine. */
	remove(path: string): Promise<void>;
	/** A folder's entries; an absent folder has none. */
	list(path: string): Promise<IndexStoreEntry[]>;
}

export interface LibraryEntry {
	name: string;
	path: string;
	kind: "file" | "folder";
	documentType?: DocumentType;
	mimeType?: string;
	size?: number;
	modifiedAt?: string;
}

export interface LibraryIO {
	/** A folder's direct entries; an absent folder has none. */
	listFolder(path: string): Promise<LibraryEntry[]>;
	readFile(path: string): Promise<Uint8Array>;
	/** Whether the path is inside a folder mapped from the user's disk. */
	isMapped(path: string): boolean;
}

/** `/home/indexes/okf` + `/Work/a.pdf` → `/home/indexes/okf/Work/a.pdf`. */
export const joinStorePath = (base: string, path: string): string => {
	const tail = path.replace(/^\/+/, "");
	return tail
		? `${base.replace(/\/+$/, "")}/${tail}`
		: base.replace(/\/+$/, "");
};
