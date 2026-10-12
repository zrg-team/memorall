import type { DocumentType } from "@/types/document-library";

/** Index types set on one folder; subfolders inherit them. */
export interface FolderIndexRule {
	/** Index types this folder adds. */
	on?: string[];
	/** Inherited index types this folder turns off. */
	off?: string[];
}

export interface FolderIndexSettings {
	/** Names to skip: `*.tmp` for files, `node_modules/` for folders. */
	skipPatterns: string[];
	/** Files larger than this get no card. */
	maxFileBytes: number;
	/** On-disk (mapped) folders get an index only after the user confirms. */
	askBeforeMapped: boolean;
	/** Agents may ask the user to add an index to a folder. */
	agentsMayAsk: boolean;
}

export interface FolderIndexConfig {
	version: 1;
	/** Folder path → its rule. Paths are library paths ("/Work/Invoices"). */
	folders: Record<string, FolderIndexRule>;
	settings: FolderIndexSettings;
}

/** One file as an index sees it, read from the library listing. */
export interface IndexedFileInfo {
	path: string;
	name: string;
	documentType: DocumentType;
	mimeType?: string;
	size: number;
	modifiedAt: string;
}

/** What one index type holds for one folder it covers. */
export interface FolderIndexTypeStatus {
	typeId: string;
	/** Files with an entry (an OKF card). */
	entries: number;
	/** Files the index covers. */
	files: number;
	updatedAt?: string;
	/** Content chunks and per-file failures, for embedding indexes. */
	chunks?: number;
	errors?: Array<{ path: string; message: string }>;
}

export interface FolderIndexSyncResult {
	created: number;
	updated: number;
	removed: number;
	unchanged: number;
	skipped: number;
}

/** A short record of one file's entry, for the Files list. */
export interface FolderIndexFileEntry {
	path: string;
	type: string;
	title?: string;
	description?: string;
}

/**
 * An index type: a way to build agent-readable data for a folder. Types are
 * registered once and the rest of the app (settings, the Files page, the
 * agent feature) works from the registry, so adding a type touches no caller.
 */
export interface FolderIndexType {
	id: string;
	label: string;
	description: string;
	/** Agent tools this type's data is read with. */
	tools: readonly string[];
	/** Instructions for those tools, added to the agent's prompt. */
	prompt: string;
	/**
	 * Brings the index of `root` (a folder this type covers) up to date.
	 * `nestedRoots` are roots of the same type inside it (below a subfolder
	 * that left the index): they are indexed on their own and left alone.
	 */
	sync(
		root: string,
		files: IndexedFileInfo[],
		options?: { nestedRoots?: string[] },
	): Promise<FolderIndexSyncResult>;
	/** Removes everything this type built for `root`. */
	remove(root: string): Promise<void>;
	status(root: string): Promise<FolderIndexTypeStatus>;
	/** Entries of the files directly in `folder`. */
	entries(folder: string): Promise<FolderIndexFileEntry[]>;
}

/** A folder's index drawn as a graph: folders and cards, joined by what contains and links what. */
export interface FolderIndexGraph {
	nodes: Array<{
		/** Library path of the folder or file. */
		id: string;
		kind: "folder" | "card";
		label: string;
		/** A card's concept type. */
		type?: string;
		description?: string;
	}>;
	edges: Array<{
		source: string;
		target: string;
		kind: "contains" | "link";
	}>;
	/** True when the folder had more cards than a graph draws. */
	truncated: boolean;
}

/** A registered type as settings and the agent page show it. */
export interface FolderIndexTypeInfo {
	id: string;
	label: string;
	description: string;
	tools: readonly string[];
}

/** One folder with an index, for the Indexes settings. */
export interface IndexedFolderSummary {
	path: string;
	/** Types this folder sets itself. */
	on: string[];
	/** Inherited types this folder turns off. */
	off: string[];
	/** Types in effect here, own and inherited. */
	effective: string[];
	/** On-disk folder (mapped from the user's computer). */
	mapped: boolean;
	status: FolderIndexTypeStatus[];
}

export interface FolderIndexState {
	types: FolderIndexTypeInfo[];
	settings: FolderIndexSettings;
	folders: IndexedFolderSummary[];
}
