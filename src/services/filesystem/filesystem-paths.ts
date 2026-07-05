export const FILESYSTEM_SCOPE = {
	ROOT: "root",
	DOCUMENTS: "documents",
	WORKSPACE: "workspace",
} as const;

export type FilesystemScope =
	(typeof FILESYSTEM_SCOPE)[keyof typeof FILESYSTEM_SCOPE];

const legacyMountPath = <TScope extends string>(scope: TScope) =>
	`/${scope}` as `/${TScope}`;

export const FILESYSTEM_MOUNT_PATH = {
	ROOT: "/",
	DOCUMENTS: legacyMountPath(FILESYSTEM_SCOPE.DOCUMENTS),
	WORKSPACES: legacyMountPath("workspaces"),
} as const;
