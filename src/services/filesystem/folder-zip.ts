/**
 * A folder from Files as one .zip, for the Files page, the MemonOS Bot Files
 * app and the agent alike.
 */

import { zipSync, type Zippable } from "fflate";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";

/** A zip is built in memory: past this the browser tab is at risk. */
export const MAX_FOLDER_ZIP_BYTES = 1024 * 1024 * 1024;

/** Already compressed: deflating them again only costs time. */
const STORED_EXTENSIONS = new Set([
	"zip",
	"gz",
	"tgz",
	"7z",
	"rar",
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"avif",
	"mp3",
	"mp4",
	"m4a",
	"mov",
	"webm",
	"ogg",
	"pdf",
	"docx",
	"xlsx",
	"pptx",
	"woff",
	"woff2",
]);

export type FolderZipFileSystem = Pick<
	IFlowFileSystem,
	"readdir" | "readFile" | "stat"
>;

export interface FolderZip {
	/** The folder's name with .zip. */
	name: string;
	bytes: Uint8Array;
	fileCount: number;
	/** The files' total size before compression. */
	totalBytes: number;
}

const baseName = (path: string) =>
	path.replace(/\/+$/, "").split("/").pop() || "files";

const joinPath = (dir: string, name: string) =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;

export const folderZipName = (folderPath: string): string =>
	`${baseName(folderPath)}.zip`;

/**
 * Every file under the folder, at its path inside it, in one zip whose top
 * folder is the folder itself. Empty folders keep their place.
 */
export const zipFolder = async (
	fs: FolderZipFileSystem,
	folderPath: string,
	{ maxBytes = MAX_FOLDER_ZIP_BYTES }: { maxBytes?: number } = {},
): Promise<FolderZip> => {
	const root = folderPath.replace(/\/+$/, "") || "/";
	if (!(await fs.stat(root)).isDirectory()) {
		throw new Error(`${root} is not a folder.`);
	}
	const top = root === "/" ? "files" : baseName(root);
	const tree: Zippable = {};
	let fileCount = 0;
	let totalBytes = 0;

	const walk = async (dir: string, into: Zippable) => {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const path = joinPath(dir, entry.name);
			if (entry.isDirectory()) {
				const child: Zippable = {};
				await walk(path, child);
				// An empty folder is a "name/" entry; nested empties vanish.
				if (Object.keys(child).length > 0) into[entry.name] = child;
				else into[`${entry.name}/`] = new Uint8Array(0);
				continue;
			}
			if (!entry.isFile()) continue;
			const bytes = await fs.readFile(path);
			totalBytes += bytes.byteLength;
			if (totalBytes > maxBytes) {
				throw new Error(
					`${root} holds more than ${Math.round(maxBytes / 1024 / 1024)} MB; zip a smaller folder.`,
				);
			}
			const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
			into[entry.name] = STORED_EXTENSIONS.has(extension)
				? [bytes, { level: 0 }]
				: bytes;
			fileCount += 1;
		}
	};

	const contents: Zippable = {};
	tree[top] = contents;
	await walk(root, contents);
	return {
		name: folderZipName(root),
		bytes: zipSync(tree, { level: 6 }),
		fileCount,
		totalBytes,
	};
};
