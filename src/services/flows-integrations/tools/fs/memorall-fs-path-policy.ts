import { setFsPathResolver } from "flow-core/tools/fs/util";

const DOCUMENTS_PREFIX = "/documents";
const WORKSPACES_PREFIX = "/workspaces";
const WORKSPACE_FS_ROOT = "/home/workspace";

const stripPrefix = (path: string, prefix: string): string => {
	if (path === prefix) return "/";
	return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
};

setFsPathResolver((path) => {
	if (path === WORKSPACES_PREFIX) return WORKSPACE_FS_ROOT;
	if (path.startsWith(`${WORKSPACES_PREFIX}/`)) {
		return `${WORKSPACE_FS_ROOT}${path.slice(WORKSPACES_PREFIX.length)}`;
	}
	return stripPrefix(path, DOCUMENTS_PREFIX);
});
