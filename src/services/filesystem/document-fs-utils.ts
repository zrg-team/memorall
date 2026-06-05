import type { DocumentFileSystem } from "@/services/filesystem/document-filesystem";
import fs, { initializeFs } from "@/services/filesystem/fs";
import {
	sandboxPathToFsPath,
	toWorkspacesSandboxPath,
} from "@/services/filesystem/sandbox-paths";

export const ensureFolderExists = async (
	dfs: DocumentFileSystem,
	folderPath: string,
): Promise<void> => {
	if (folderPath === "/" || !folderPath) return;
	const segments = folderPath.split("/").filter(Boolean);
	let currentPath = "/";
	for (const segment of segments) {
		const nextPath = `${currentPath === "/" ? "" : currentPath}/${segment}`;
		try {
			await dfs.mkdir(toWorkspacesSandboxPath(nextPath));
		} catch {
			// Folder likely already exists — continue.
		}
		currentPath = nextPath;
	}
};

export const ensureFsDirectory = async (
	directoryPath: string,
): Promise<void> => {
	const segments = directoryPath.split("/").filter(Boolean);
	let currentPath = "";
	for (const segment of segments) {
		currentPath += `/${segment}`;
		try {
			const stat = await fs.promises.stat(currentPath);
			if (!stat.isDirectory()) {
				throw new Error(`Path exists but is not a directory: ${currentPath}`);
			}
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				await fs.promises.mkdir(currentPath);
				continue;
			}
			throw error;
		}
	}
};

export const writeWorkspaceFileBytes = async (
	sandboxPath: string,
	bytes: Uint8Array,
): Promise<void> => {
	await initializeFs();
	const fsPath = sandboxPathToFsPath(sandboxPath);
	const dirPath = fsPath.substring(0, fsPath.lastIndexOf("/"));
	await ensureFsDirectory(dirPath);
	await fs.promises.writeFile(fsPath, bytes);
};
