import type { DocumentType } from "@/types/document-library";
import type {
	IndexStoreEntry,
	IndexStoreIO,
	LibraryEntry,
	LibraryIO,
} from "../storage";

/** An index store in memory: path → text. */
export const memoryStore = (): IndexStoreIO & {
	files: Map<string, string>;
} => {
	const files = new Map<string, string>();
	return {
		files,
		async read(path) {
			return files.get(path) ?? null;
		},
		async write(path, text) {
			files.set(path, text);
		},
		async remove(path) {
			for (const key of [...files.keys()]) {
				if (key === path || key.startsWith(`${path}/`)) files.delete(key);
			}
		},
		async list(path) {
			const prefix = `${path.replace(/\/+$/, "")}/`;
			const entries = new Map<string, IndexStoreEntry>();
			for (const key of files.keys()) {
				if (!key.startsWith(prefix)) continue;
				const rest = key.slice(prefix.length);
				const [name, ...more] = rest.split("/");
				entries.set(name, { name, kind: more.length ? "folder" : "file" });
			}
			return [...entries.values()];
		},
	};
};

export interface MemoryFile {
	content: string;
	documentType?: DocumentType;
	modifiedAt?: string;
}

/** A library in memory: file path → file. Folders are implied by paths. */
export const memoryLibrary = (
	initial: Record<string, MemoryFile>,
	mapped: string[] = [],
): LibraryIO & { files: Map<string, MemoryFile> } => {
	const files = new Map(Object.entries(initial));
	return {
		files,
		async listFolder(path) {
			const prefix = path === "/" ? "/" : `${path}/`;
			const entries = new Map<string, LibraryEntry>();
			for (const [filePath, file] of files) {
				if (!filePath.startsWith(prefix)) continue;
				const [name, ...more] = filePath.slice(prefix.length).split("/");
				const childPath = `${prefix}${name}`;
				entries.set(
					name,
					more.length
						? { name, path: childPath, kind: "folder" }
						: {
								name,
								path: childPath,
								kind: "file",
								documentType: file.documentType ?? "text",
								size: new TextEncoder().encode(file.content).byteLength,
								modifiedAt: file.modifiedAt ?? "2026-10-01T00:00:00.000Z",
							},
				);
			}
			return [...entries.values()];
		},
		async readFile(path) {
			const file = files.get(path);
			if (!file) throw new Error(`ENOENT: ${path}`);
			return new TextEncoder().encode(file.content);
		},
		isMapped: (path) =>
			mapped.some((root) => path === root || path.startsWith(`${root}/`)),
	};
};
