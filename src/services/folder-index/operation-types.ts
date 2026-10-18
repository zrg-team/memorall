import type {
	FolderIndexFileEntry,
	FolderIndexGraph,
	FolderIndexProgress,
	FolderIndexSettings,
	FolderIndexState,
} from "./types";
import type {
	EmbeddingChunk,
	EmbeddingSearchInput,
	EmbeddingSearchResult,
} from "./embedding/types";

/**
 * Operations of the `folder-index-operation` background job. Import-free at
 * runtime so UI code can use them without pulling in the indexers.
 */
export { FOLDER_INDEX_OPERATION_JOB_NAME } from "./constants";

export type FolderIndexStateView = FolderIndexState & {
	/** Roots being indexed right now, as "type:/path". */
	running: string[];
	activity?: Record<string, "checking" | "indexing">;
	/** Live file counts by running root, as "type:/path". */
	progress?: Record<string, FolderIndexProgress>;
	/** Roots waiting their turn to be indexed, as "type:/path". */
	queued?: string[];
	/** When changes the library reported are due to be indexed (ms). */
	changesDueAt?: number;
};

export interface FolderIndexCard {
	/** The file's library path. */
	path: string;
	/** The card as stored: frontmatter and body. */
	text: string;
	type: string;
	title?: string;
	description?: string;
	tags: string[];
	trust: "unverified" | "machine-confirmed" | "human-reviewed";
	status: string;
	stale: boolean;
	/** When the card was last written from the file. */
	generatedAt?: string;
	/** File facts from the card, e.g. "Size: 1.5 KB". */
	facts: string[];
	/** The start of the file's text, as the card keeps it. */
	excerpt?: string;
	/** Library paths of the files the card links to. */
	links: string[];
	/** What a person or agent added to the card. */
	notes?: string;
}

export interface FolderIndexOperationPayloadMap {
	"state.get": Record<string, never>;
	"folder.setType": { path: string; typeId: string; enabled: boolean };
	"settings.set": { settings: Partial<FolderIndexSettings> };
	"folder.rebuild": { path: string };
	/** Entries of the files directly in a folder, for the Files list. */
	"folder.entries": { path: string };
	/** The folder's OKF index as a graph of folders and cards. */
	"folder.graph": { path: string };
	"embedding.search": EmbeddingSearchInput;
	"embedding.chunks": { path: string };
	"card.get": { path: string };
	"card.save": {
		path: string;
		fields: {
			type?: string;
			title?: string;
			description?: string;
			tags?: string[];
		};
	};
}

export interface FolderIndexOperationResultMap {
	"state.get": FolderIndexStateView;
	"folder.setType": FolderIndexStateView;
	"settings.set": FolderIndexStateView;
	"folder.rebuild": FolderIndexStateView;
	"folder.entries": {
		effective: string[];
		entries: Record<string, FolderIndexFileEntry[]>;
	};
	"folder.graph": FolderIndexGraph;
	"embedding.search": EmbeddingSearchResult;
	"embedding.chunks": Omit<EmbeddingChunk, "vector">[];
	"card.get": FolderIndexCard | null;
	"card.save": FolderIndexCard | null;
}

export type FolderIndexOperation = keyof FolderIndexOperationPayloadMap;

export type FolderIndexOperationJobPayload = {
	[K in FolderIndexOperation]: {
		operation: K;
		payload: FolderIndexOperationPayloadMap[K];
	};
}[FolderIndexOperation];

export interface FolderIndexOperationJobResult extends Record<string, unknown> {
	operation: FolderIndexOperation;
	result: unknown;
}
