import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import fs from "@/services/filesystem/fs";
import {
	sandboxPathToFsPath,
	toDocumentsSandboxPath,
} from "@/services/filesystem/sandbox-paths";
import type { HostFileEntry, HostFiles } from "./types";

const join = (dir: string, name: string): string =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;

/**
 * Host files for `py` and redirects: reads go straight to ZenFS (binary-safe
 * and fast); writes go through the documents service so the Files views and
 * the sandbox hear about them.
 */
export const createHostFiles = (): HostFiles => {
	const ready = () => documentFileSystemService.initialize();
	const stat = async (path: string) => {
		await ready();
		return fs.promises.stat(sandboxPathToFsPath(path));
	};

	return {
		async isDirectory(path) {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		async exists(path) {
			try {
				await stat(path);
				return true;
			} catch {
				return false;
			}
		},
		async walk(dir, { skipDirs, maxFiles, maxBytes }) {
			await ready();
			const files: HostFileEntry[] = [];
			let bytes = 0;
			let truncated = false;
			const visit = async (current: string): Promise<void> => {
				const names = await fs.promises.readdir(sandboxPathToFsPath(current));
				for (const name of names.sort()) {
					if (truncated) return;
					const path = join(current, name);
					const info = await fs.promises.stat(sandboxPathToFsPath(path));
					if (info.isDirectory()) {
						if (!skipDirs.has(name)) await visit(path);
						continue;
					}
					if (files.length >= maxFiles || bytes + info.size > maxBytes) {
						truncated = true;
						return;
					}
					files.push({ path, size: info.size });
					bytes += info.size;
				}
			};
			await visit(dir);
			return { files, truncated };
		},
		async read(path) {
			await ready();
			return new Uint8Array(
				await fs.promises.readFile(sandboxPathToFsPath(path)),
			);
		},
		write: (path, data) =>
			documentFileSystemService.writeFile(toDocumentsSandboxPath(path), data),
		async append(path, data) {
			let existing = "";
			try {
				existing = new TextDecoder().decode(await this.read(path));
			} catch {
				existing = "";
			}
			await this.write(path, existing + data);
		},
		remove: (path) =>
			documentFileSystemService.deleteFile(toDocumentsSandboxPath(path)),
	};
};
