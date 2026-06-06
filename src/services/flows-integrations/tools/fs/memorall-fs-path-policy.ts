import type { FsToolConfig } from "flow-core/tools/fs/config";
import {
	sandboxPathToFsPath,
	isWorkspacesSandboxPath,
	isDocumentsSandboxPath,
	toDocumentsLogicalPath,
} from "@/services/filesystem/sandbox-paths";

export const memorallFsPathResolver: NonNullable<
	FsToolConfig["pathResolver"]
> = (path) => {
	if (isWorkspacesSandboxPath(path)) return sandboxPathToFsPath(path);
	if (isDocumentsSandboxPath(path)) return toDocumentsLogicalPath(path) ?? "/";
	return path;
};

export const memorallFsToolConfig: FsToolConfig = {
	pathResolver: memorallFsPathResolver,
};
