import type { FsToolConfig } from "@/services/flows-legacy/tools/fs/config";
import {
	normalizeSandboxPath,
	sandboxPathToFsPath,
} from "@/services/filesystem/sandbox-paths";

export const memorallFsPathResolver: NonNullable<
	FsToolConfig["pathResolver"]
> = (path) => {
	return sandboxPathToFsPath(normalizeSandboxPath(path));
};

export const memorallFsToolConfig: FsToolConfig = {
	pathResolver: memorallFsPathResolver,
};
