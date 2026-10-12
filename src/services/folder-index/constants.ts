/**
 * Folder indexes: extra, agent-readable data the app keeps about the files in
 * a folder the user chose. Each kind of index is an index type (OKF is the
 * first); a folder can have several.
 *
 * Import-free at runtime so the feature catalog and the UI can use the names
 * without pulling in the indexers.
 */

/**
 * Where every index lives, beside `/home/files` rather than inside it, like
 * skills: the Files tab and the agent's file tools never see it, so an index
 * cannot be edited or deleted as if it were one of the user's documents.
 */
export const FOLDER_INDEX_ROOT = "/home/indexes" as const;

/** Which folders have which index types, and the indexing rules. */
export const FOLDER_INDEX_CONFIG_PATH =
	`${FOLDER_INDEX_ROOT}/config.json` as const;

export const FOLDER_INDEX_OPERATION_JOB_NAME =
	"folder-index-operation" as const;

export const FOLDER_INDEX_FEATURE_ID = "step-folder-index-feature" as const;
export const FOLDER_INDEX_STEP_NAME = "folder-index-feature" as const;
export const FILE_OKF_INDEX_FEATURE_ID = "step-file-okf-index-feature" as const;
export const FILE_OKF_INDEX_STEP_NAME = "file-okf-index-feature" as const;
export const FILE_EMBEDDING_INDEX_FEATURE_ID =
	"step-file-embedding-index-feature" as const;
export const FILE_EMBEDDING_INDEX_STEP_NAME =
	"file-embedding-index-feature" as const;

/** OKF: Open Knowledge Format, https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf */
export const OKF_INDEX_TYPE_ID = "okf" as const;
export const OKF_VERSION = "0.2" as const;

export const OKF_INDEX_TOOL = "okf_index" as const;
export const OKF_READ_TOOL = "okf_read" as const;
export const OKF_SEARCH_TOOL = "okf_search" as const;
export const OKF_TOOLS = [
	OKF_INDEX_TOOL,
	OKF_READ_TOOL,
	OKF_SEARCH_TOOL,
] as const;

/** Who wrote a card, in OKF's actor convention (§7). */
export const OKF_INDEXER_ACTOR = "process:memorall-okf-indexer" as const;
export const OKF_USER_ACTOR = "human:me" as const;

export const EMBEDDING_INDEX_TYPE_ID = "embeddings" as const;
export const EMBEDDING_SEARCH_TOOL = "embedding_search" as const;
export const EMBEDDING_CHUNKS_TOOL = "embedding_chunks" as const;

export const DEFAULT_MAX_INDEXED_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_EMBEDDING_CHUNKS_PER_FILE = 2000;
export const DEFAULT_SKIP_PATTERNS: readonly string[] = [
	"*.tmp",
	"*.key",
	"*.env",
	"node_modules/",
	".git/",
];
