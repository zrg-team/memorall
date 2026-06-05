import { setFsPathResolver } from "flow-core/tools/fs/util";
import {
	sandboxPathToFsPath,
	isWorkspacesSandboxPath,
	isDocumentsSandboxPath,
	toDocumentsLogicalPath,
} from "@/services/filesystem/sandbox-paths";

setFsPathResolver((path) => {
	if (isWorkspacesSandboxPath(path)) return sandboxPathToFsPath(path);
	if (isDocumentsSandboxPath(path)) return toDocumentsLogicalPath(path) ?? "/";
	return path;
});
