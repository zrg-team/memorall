import fs, { initializeFs } from "@/services/filesystem/fs";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { isInsideNativeMount } from "@/services/filesystem/native-folders/mount-registry";
import type {
	IndexStoreEntry,
	IndexStoreIO,
	LibraryEntry,
	LibraryIO,
} from "./storage";

/**
 * The real store and library, for the context that runs indexing (where the
 * background jobs run). The UI never reads the store directly: it asks
 * through the folder-index operation, so it never sees a stale cache.
 */

const isMissing = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	((error as { code?: unknown }).code === "ENOENT" ||
		/ENOENT|no such file/i.test(
			String((error as { message?: unknown }).message ?? ""),
		));

const ensureFolder = async (path: string): Promise<void> => {
	let current = "";
	for (const part of path.split("/").filter(Boolean)) {
		current = `${current}/${part}`;
		try {
			await fs.promises.mkdir(current);
		} catch (error) {
			if ((error as { code?: unknown })?.code !== "EEXIST") {
				const stat = await fs.promises.stat(current).catch(() => null);
				if (!stat?.isDirectory()) throw error;
			}
		}
	}
};

export const zenIndexStore: IndexStoreIO = {
	async exists(path) {
		await initializeFs();
		try {
			return (await fs.promises.stat(path)).isFile();
		} catch (error) {
			if (isMissing(error)) return false;
			throw error;
		}
	},
	async read(path) {
		await initializeFs();
		try {
			const bytes = await fs.promises.readFile(path);
			return new TextDecoder().decode(bytes);
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
	},
	async write(path, text) {
		await initializeFs();
		const slash = path.lastIndexOf("/");
		if (slash > 0) await ensureFolder(path.slice(0, slash));
		// Keep the previous checkpoint readable if a write is interrupted.
		const temporary = `${path}.pending-${crypto.randomUUID()}`;
		try {
			await fs.promises.writeFile(temporary, new TextEncoder().encode(text));
			await fs.promises.rename(temporary, path);
		} finally {
			await fs.promises.rm(temporary, { force: true }).catch(() => {});
		}
	},
	async remove(path) {
		await initializeFs();
		try {
			await fs.promises.rm(path, { recursive: true, force: true });
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
	},
	async list(path) {
		await initializeFs();
		try {
			const entries = await fs.promises.readdir(path, { withFileTypes: true });
			return entries.map(
				(entry): IndexStoreEntry => ({
					name: entry.name,
					kind: entry.isDirectory() ? "folder" : "file",
				}),
			);
		} catch (error) {
			if (isMissing(error)) return [];
			throw error;
		}
	},
};

const toIso = (value: unknown): string | undefined => {
	if (!value) return undefined;
	const date = value instanceof Date ? value : new Date(value as string);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const documentLibrary: LibraryIO = {
	async listFolder(path) {
		// One directory listing; resolving a node first builds the entire library tree.
		const children = await documentFileSystemService.getFolderChildren(path);
		return children.map(
			(child): LibraryEntry =>
				child.type === "folder"
					? { name: child.name, path: child.path, kind: "folder" }
					: {
							name: child.name,
							path: child.path,
							kind: "file",
							documentType: child.file?.type ?? "other",
							mimeType: child.file?.mimeType,
							size: child.file?.size ?? 0,
							modifiedAt: toIso(child.file?.modifiedAt),
						},
		);
	},
	readFile: (path) => documentFileSystemService.readFile(path),
	isMapped: (path) => isInsideNativeMount(path),
};
