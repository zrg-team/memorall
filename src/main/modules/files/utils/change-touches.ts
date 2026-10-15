import type { FilesystemChangeEvent } from "@/services/filesystem/document-filesystem";

/** Whether a filesystem change can have altered the file at `path`. */
export function changeTouches(
	change: FilesystemChangeEvent | null,
	path: string,
): boolean {
	// No details: anything may have changed.
	if (!change) return true;
	if (change.changes) {
		return change.changes.some((inner) => changeTouches(inner, path));
	}
	return [change.path, change.oldPath, change.newPath].some((changed) => {
		if (changed === undefined) return false;
		const target = changed.replace(/\/+$/, "");
		// The file itself, or a folder it is in.
		return path === target || path.startsWith(`${target}/`);
	});
}
