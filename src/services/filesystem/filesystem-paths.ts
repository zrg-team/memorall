export const FILESYSTEM_SCOPE = {
	DOCUMENTS: "documents",
	WORKSPACE: "workspace",
} as const;

export type FilesystemScope =
	(typeof FILESYSTEM_SCOPE)[keyof typeof FILESYSTEM_SCOPE];

export const FILESYSTEM_MOUNT_PATH = {
	DOCUMENTS: "/documents",
	WORKSPACES: "/workspaces",
} as const;
