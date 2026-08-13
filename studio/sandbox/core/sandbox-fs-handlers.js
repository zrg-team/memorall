import {
	DOCUMENTS_MOUNT_ROOT,
	WORKSPACES_MOUNT_ROOT,
	VFS_WORKSPACE_MATERIALIZE_SYNC,
	vfsBoolState,
	mountedDocumentFiles,
	mountedDocumentDirectories,
	materializedMountedFiles,
	mountedWorkspaceFiles,
	mountedWorkspaceDirectories,
	materializedWorkspaceFiles,
	pendingWorkspaceOps,
	materializeMountedDocumentFileContent,
	materializeMountedWorkspaceFileContent,
	normalizePath,
	dirname,
	toCanonicalMountedPath,
	isDocumentsPath,
	isWorkspacePath,
} from "./sandbox-vfs.js";

/**
 * Handle all fs.* operations.
 * Returns the result object or throws on error.
 * Throws an "unsupported" error for unknown fs operations.
 */
export const handleFsOperation = async (operation, payload, c) => {
	switch (operation) {
		case "fs.writeFile": {
			const p = toCanonicalMountedPath(payload.path);
			if (isDocumentsPath(p)) throw new Error(`Path is read-only: ${p}`);
			await c.vfs.writeFile(p, payload.content);
			return { path: p };
		}
		case "fs.readFile": {
			const p = toCanonicalMountedPath(payload.path);
			const content = await c.vfs.readFile(p, "utf8");
			return { path: p, content: typeof content === "string" ? content : new TextDecoder().decode(content) };
		}
		case "fs.mkdir": {
			const p = toCanonicalMountedPath(payload.path);
			if (isDocumentsPath(p)) throw new Error(`Path is read-only: ${p}`);
			await c.vfs.mkdir(p, { recursive: payload.recursive !== false });
			return { path: p };
		}
		case "fs.readdir": {
			const p = toCanonicalMountedPath(payload.path);
			const entries = await c.vfs.readdir(p);
			return { path: p, entries };
		}
		case "fs.unlink": {
			const p = toCanonicalMountedPath(payload.path);
			if (isDocumentsPath(p)) throw new Error(`Path is read-only: ${p}`);
			await c.vfs.unlink(p);
			return { path: p };
		}
		case "fs.rename": {
			const oldPath = toCanonicalMountedPath(payload.oldPath);
			const newPath = toCanonicalMountedPath(payload.newPath);
			if (isDocumentsPath(oldPath) || isDocumentsPath(newPath)) {
				throw new Error(`Mounted documents path is read-only: ${oldPath} -> ${newPath}`);
			}
			await c.vfs.rename(oldPath, newPath);
			return { oldPath, newPath };
		}
		case "fs.exists": {
			const p = toCanonicalMountedPath(payload.path);
			if (isDocumentsPath(p) && !vfsBoolState.documentsMountLoaded) {
				return { path: p, exists: false };
			}
			if (isWorkspacePath(p) && !vfsBoolState.workspaceMountLoaded) {
				return { path: p, exists: false };
			}
			return { path: p, exists: await c.vfs.exists(p) };
		}
		case "fs.mountDocuments": {
			mountedDocumentFiles.clear();
			mountedDocumentDirectories.clear();
			materializedMountedFiles.clear();
			mountedDocumentDirectories.add(DOCUMENTS_MOUNT_ROOT);
			vfsBoolState.documentsMountLoaded = true;

			for (const dirPath of payload.directories ?? []) {
				const p = normalizePath(dirPath);
				if (isDocumentsPath(p)) mountedDocumentDirectories.add(p);
			}
			for (const filePath of payload.files ?? []) {
				const p = normalizePath(filePath);
				if (!isDocumentsPath(p)) continue;
				mountedDocumentFiles.add(p);
				mountedDocumentDirectories.add(dirname(p));
			}
			return {
				mounted: true,
				directoryCount: mountedDocumentDirectories.size,
				fileCount: mountedDocumentFiles.size,
			};
		}
		case "fs.mountWorkspace": {
			mountedWorkspaceFiles.clear();
			mountedWorkspaceDirectories.clear();
			materializedWorkspaceFiles.clear();
			mountedWorkspaceDirectories.add(WORKSPACES_MOUNT_ROOT);
			pendingWorkspaceOps.length = 0;
			vfsBoolState.workspaceMountLoaded = true;

			for (const dirPath of payload.directories ?? []) {
				const p = toCanonicalMountedPath(dirPath);
				if (isWorkspacePath(p)) mountedWorkspaceDirectories.add(p);
			}
			for (const filePath of payload.files ?? []) {
				const p = toCanonicalMountedPath(filePath);
				if (!isWorkspacePath(p)) continue;
				mountedWorkspaceFiles.add(p);
				mountedWorkspaceDirectories.add(dirname(p));
			}
			return {
				mounted: true,
				directoryCount: mountedWorkspaceDirectories.size,
				fileCount: mountedWorkspaceFiles.size,
			};
		}
		case "fs.materializeDocumentFile": {
			const p = normalizePath(payload.path);
			if (!mountedDocumentFiles.has(p)) throw new Error(`Mounted file not found: ${p}`);
			materializeMountedDocumentFileContent(p, payload.content);
			return { path: p, materialized: true };
		}
		case "fs.materializeWorkspaceFile": {
			const p = toCanonicalMountedPath(payload.path);
			if (typeof c.vfs?.[VFS_WORKSPACE_MATERIALIZE_SYNC] === "function") {
				c.vfs[VFS_WORKSPACE_MATERIALIZE_SYNC](p, payload.content);
			} else {
				materializeMountedWorkspaceFileContent(p, payload.content);
			}
			return { path: p, materialized: true };
		}
		case "fs.flushWorkspaceWrites": {
			const ops = pendingWorkspaceOps.splice(0, pendingWorkspaceOps.length);
			return { ops };
		}
		default:
			throw new Error(`Unsupported fs operation: ${operation}`);
	}
};
