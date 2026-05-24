import type { IFlowFileSystem } from "../interfaces/filesystem";

export const ensureFolderExists = async (
	fs: IFlowFileSystem,
	folderPath: string,
): Promise<void> => {
	if (folderPath === "/" || !folderPath) return;
	const segments = folderPath.split("/").filter(Boolean);
	let currentPath = "/";
	for (const segment of segments) {
		const nextPath = `${currentPath === "/" ? "" : currentPath}/${segment}`;
		try {
			await fs.mkdir(nextPath);
		} catch {
			// Existing folder or virtual FS conflict; continue so callers can write.
		}
		currentPath = nextPath;
	}
};

export const workspaceSandboxPathToFsPath = (sandboxPath: string): string => {
	const normalized = sandboxPath.replace(/\\/g, "/");
	const base =
		normalized === "workspace" || normalized.startsWith("workspace/")
			? "workspace"
			: "workspaces";
	const logical = normalized === base ? "" : normalized.slice(base.length);
	return `/home/workspace${logical}`;
};

export const writeFlowFileBytes = async (
	fs: IFlowFileSystem,
	sandboxPath: string,
	bytes: Uint8Array,
): Promise<void> => {
	const fsPath = workspaceSandboxPathToFsPath(sandboxPath);
	const dirPath = fsPath.substring(0, fsPath.lastIndexOf("/"));
	await fs.mkdir(dirPath, { recursive: true });
	await fs.writeFile(fsPath, bytes);
};
